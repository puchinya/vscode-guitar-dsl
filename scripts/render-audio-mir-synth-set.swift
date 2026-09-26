// Renders the specs written by scripts/generate-audio-mir-synth-set.mjs to WAV with the
// macOS built-in GM sound bank (AVAudioEngine offline rendering). Local use only.
//
//   xcrun swiftc -O scripts/render-audio-mir-synth-set.swift -o <tmp>/render-audio-mir-synth-set
//   <tmp>/render-audio-mir-synth-set <set dir>
//
// Each <id>.json becomes <id>.wav (44.1 kHz, 16-bit, stereo) next to it.
import AVFoundation
import Foundation

let gmBank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
let melodicBank: UInt8 = 0x79
let percussionBank: UInt8 = 0x78
let sampleRate = 44_100.0
let granularity: AVAudioFrameCount = 64

struct Part: Decodable {
  let role: String
  let bank: String
  let program: Int
  /// `[seconds, on (1) / off (0), note, velocity]`
  let events: [[Double]]
}

struct Spec: Decodable {
  let id: String
  let seconds: Double
  let parts: [Part]
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

func render(_ spec: Spec, to url: URL) throws -> Float {
  let engine = AVAudioEngine()
  var samplers: [AVAudioUnitSampler] = []
  for part in spec.parts {
    let sampler = AVAudioUnitSampler()
    engine.attach(sampler)
    engine.connect(sampler, to: engine.mainMixerNode, format: nil)
    try sampler.loadSoundBankInstrument(
      at: gmBank, program: UInt8(part.program),
      bankMSB: part.bank == "percussion" ? percussionBank : melodicBank, bankLSB: 0)
    samplers.append(sampler)
  }
  engine.mainMixerNode.outputVolume = 0.5
  let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
  try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
  try engine.start()

  var events: [(frame: Int, part: Int, on: Bool, note: UInt8, velocity: UInt8)] = []
  for (p, part) in spec.parts.enumerated() {
    for e in part.events {
      events.append((Int(e[0] * sampleRate), p, e[1] > 0.5, UInt8(e[2]), UInt8(e[3])))
    }
  }
  // Note-offs before note-ons at the same frame, so re-struck notes sound.
  events.sort { $0.frame != $1.frame ? $0.frame < $1.frame : (!$0.on && $1.on) }

  let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 2,
    AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
  ]
  let file = try AVAudioFile(forWriting: url, settings: settings)
  let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: granularity)!
  let total = Int(spec.seconds * sampleRate)
  var frame = 0
  var next = 0
  var peak: Float = 0
  while frame < total {
    while next < events.count && events[next].frame <= frame {
      let e = events[next]
      if e.on {
        samplers[e.part].startNote(e.note, withVelocity: e.velocity, onChannel: 0)
      } else {
        samplers[e.part].stopNote(e.note, onChannel: 0)
      }
      next += 1
    }
    let status = try engine.renderOffline(granularity, to: buffer)
    guard status == .success else { fail("render status \(status.rawValue) for \(spec.id)") }
    for c in 0..<2 {
      let data = buffer.floatChannelData![c]
      for i in 0..<Int(buffer.frameLength) { peak = max(peak, abs(data[i])) }
    }
    try file.write(from: buffer)
    frame += Int(buffer.frameLength)
  }
  engine.stop()
  return peak
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: render-audio-mir-synth-set <set dir>") }
let dir = URL(fileURLWithPath: args[1])
let specs = try FileManager.default.contentsOfDirectory(atPath: dir.path)
  .filter { $0.hasSuffix(".json") && $0 != "meta.json" }
  .sorted()
for name in specs {
  let spec = try JSONDecoder().decode(Spec.self, from: Data(contentsOf: dir.appendingPathComponent(name)))
  let peak = try render(spec, to: dir.appendingPathComponent("\(spec.id).wav"))
  print("\(spec.id): \(String(format: "%.1f", spec.seconds)) s, peak \(String(format: "%.2f", peak))\(peak >= 1 ? " (clipped)" : "")")
}
