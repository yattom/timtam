# Playwright Fake Audio Capture Research

## Overview
This document summarizes research on using Playwright's fake audio capture capabilities for testing WebRTC applications, particularly for Amazon Chime SDK transcription testing.

---

## Official Documentation Status

⚠️ **Important**: `--use-file-for-fake-audio-capture` is **NOT documented in official Playwright documentation**. It is a **Chromium browser flag**, not a Playwright-specific feature. It can be used with Playwright by passing it as a browser launch argument.

---

## How to Use Fake Audio Capture

### Required Browser Flags

Three Chrome arguments must be used together:

```javascript
{
  args: [
    '--use-fake-device-for-media-stream',        // Use emulated input instead of physical hardware
    '--use-fake-ui-for-media-stream',            // Bypass permission dialogs
    '--use-file-for-fake-audio-capture=/path/to/audio.wav'  // Specify audio file
  ]
}
```

### Audio File Format Requirements

**Recommended Format:**
- **WAV file** with 1 channel (mono) and 48 kHz sample rate
- 16-bit PCM is also commonly supported

**Alternative formats tested:**
- MP3: Works but may have compatibility issues with transcription services
- Different sample rates: 8kHz, 16kHz, 24kHz, 48kHz all supported by Opus codec

---

## Critical Issues and Pitfalls

### 1. **Looping Behavior** 🔄

**Problem**: By default, the audio file plays in a loop continuously.

**Solution**: Add `%noloop` at the end of the file path:
```javascript
'--use-file-for-fake-audio-capture=/path/to/audio.wav%noloop'
```

### 2. **Audio File Must Be Set at Initialization** ⚠️

**Problem**: Playwright sets the audio file reference on initialization. If you try to change the file after the test starts, no audio will play (no errors thrown).

**Impact**: Each browser instance can only use ONE audio file for its entire lifetime.

### 3. **test.use() Breaks Audio Playback** 🐛

**Problem**: Using `test.use({})` in Playwright (even if empty) breaks audio playback completely.

**Workaround**: Set browser launch args directly when creating browser instances, not through test configuration.

### 4. **No Playback Control** 🎮

**Problem**: Audio starts playing immediately when WebRTC session establishes, before all participants connect.

**Impact**:
- Cannot synchronize audio across multiple participants
- Creates "2 monologues" instead of synchronized conversation
- No pause/play functionality available

**Status**: Feature request #31158 closed as "COMPLETED" due to limited engagement.

### 5. **Timing Unpredictability** ⏱️

**Problem**: Connection delays vary between test runs, making audio synchronization impossible to predict.

**Current Workaround**: Calculate delays through trial-and-error (unreliable).

---

## WebRTC Audio Format Requirements

### Opus Codec (Primary for WebRTC)
- Sample rates: 8, 12, 16, 24, 48 kHz (operates internally at 48 kHz)
- Bitrates: Up to 128 kbps
- **Required** by WebRTC spec (RFC 7874)

### PCM (Alternative)
- G.711 format: 8-bit samples at 8 kHz sample rate
- 16-bit PCM at 16 kHz: Common for transcription services
- Recommended RMS level: 2600 (-19 dBm0) for linear 16-bit PCM

### Amazon Chime SDK Specifics
- Supports sample rates up to **48 kHz**
- Up to 2 channels (stereo)
- Uses **Opus codec**
- Bitrates up to 128 kbps

---

## Testing Transcription Services

### Challenge: Format Mismatch

**Problem**: Playwright's fake audio uses file playback, but transcription services expect:
- Real-time audio streams
- Proper WebRTC encoding (Opus)
- Continuous data packets with timing information

**Root Cause**: The fake audio may be recognized as a microphone input by the browser, but:
1. It may not be properly encoded through WebRTC's audio pipeline
2. Timing/packet structure may not match what transcription services expect
3. Audio quality/format may be degraded during fake device simulation

### No Documented Solutions Found

⚠️ **No specific documentation or resources exist for:**
- Using Playwright with fake audio for testing transcription
- Amazon Chime SDK + Playwright integration
- Validated approaches for WebRTC transcription testing

---

## Alternative Approaches to Consider

### 1. Use Real Audio Devices
- Most reliable but requires physical hardware
- Difficult to automate in CI/CD

### 2. Mock Transcription Events
- Mock the transcription API responses
- Test UI behavior without real audio
- Doesn't test end-to-end audio pipeline

### 3. Use Browser-Level Audio Injection
- More complex but potentially more reliable
- Requires custom browser extensions or patches

### 4. Separate Audio Pipeline Testing
- Test audio capture separately from transcription
- Use unit/integration tests for audio handling
- Use E2E only for UI flows

---

## Recommendations for Amazon Chime SDK Testing

### Short-term: Focus on What Works
1. ✅ Test meeting creation and joining (works reliably)
2. ✅ Test UI interactions and state management
3. ✅ Test API calls (transcription start/stop)
4. ❌ Skip actual transcription verification in E2E tests

### Long-term: Investigate Alternatives
1. Research if Amazon has any official testing recommendations
2. Consider mocking transcription events at the SDK level
3. Explore browser automation alternatives that support WebRTC better
4. Create separate test suite for audio quality/transcription accuracy

---

## Sources

### Playwright & Fake Audio
- [Testing Web Applications with Speech and Image Recognition](https://maddevs.io/writeups/testing-web-apps-with-speech-and-image-recognition/)
- [Playwright Issue #27436: Improve fake media definition via config](https://github.com/microsoft/playwright/issues/27436)
- [Playwright Issue #24589: How to test webcam and mic](https://github.com/microsoft/playwright/issues/24589)
- [Playwright Issue #31158: Fake Audio file playback control](https://github.com/microsoft/playwright/issues/31158)
- [LinkedIn: Interesting automation case - Fake microphone input](https://www.linkedin.com/pulse/interesting-automation-case-fake-microphone-input-kirill-anisimov)

### WebRTC & Audio Formats
- [RFC 7874: WebRTC Audio Codec and Processing Requirements](https://datatracker.ietf.org/doc/html/rfc7874)
- [MDN: Codecs used by WebRTC](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/WebRTC_codecs)
- [WebRTC Testing Documentation](https://webrtc.github.io/webrtc-org/testing/)

### Amazon Chime SDK
- [How Amazon Chime SDK meetings use WebRTC media](https://docs.aws.amazon.com/chime-sdk/latest/dg/webrtc-media.html)
- [Amazon Chime SDK JavaScript GitHub](https://github.com/aws/amazon-chime-sdk-js)
- [Amazon Chime SDK Features](https://aws.amazon.com/chime/chime-sdk/features/)

---

## Conclusion

Using Playwright's `--use-file-for-fake-audio-capture` for WebRTC transcription testing is **technically possible but highly unreliable**:

- ✅ Browser recognizes the fake audio device
- ✅ getUserMedia() returns a stream
- ✅ WebRTC connection establishes
- ❌ Transcription services may not receive proper audio data
- ❌ No synchronization control for multi-participant scenarios
- ❌ No official documentation or validated patterns

**For production E2E testing of transcription features, alternative approaches should be considered.**
