# Caller clips

16 kHz, 16-bit, mono WAV. Recorded by the owner (checkpoint H1), not generated.

| File                    | Content                               |
| ----------------------- | ------------------------------------- |
| `po-status-a.wav`       | PO-status question about **PO-10482** |
| `po-status-b.wav`       | Same question about **PO-20931**      |
| `interrupt.wav`         | "Wait, stop"                          |
| `followup-delivery.wav` | "And the delivery date?"              |
| `silence-3s.wav`        | 3 seconds of silence                  |

Both PO codes exist in the generated data (`packages/tools/src/data`) with distinct statuses.

The speech clips carry a room-noise floor of about −26 dBFS RMS (≈10 dB SNR), kept on purpose as a harder test. Edge padding is digital silence. How to re-record: `RECORDING.md`.
