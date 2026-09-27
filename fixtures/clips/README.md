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

Round 2 take: speech peaks about −20 dB, background about −60 dB (−45 dB in `followup-delivery.wav`). Edge padding is digital silence. Recording guide and level check: `RECORDING.md`. Clip A was re-recorded without "dash" ("P O one zero four eight two"), matching how the agent now speaks codes.
