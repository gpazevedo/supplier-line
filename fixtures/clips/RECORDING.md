# Recording the caller clips (H1)

Record with a headset mic in a quiet room. Save every file in this folder, `fixtures/clips/`.

## Format

| Setting     | Value                                            |
| ----------- | ------------------------------------------------ |
| Container   | WAV                                              |
| Encoding    | PCM signed 16-bit little-endian (`pcm_s16le`)    |
| Sample rate | 16,000 Hz                                        |
| Channels    | 1 (mono)                                         |
| Processing  | None: no normalization, noise removal or effects |
| Padding     | About 0.5 s of quiet before and after speaking   |

## Clips

| File                    | Say                                                                       |
| ----------------------- | ------------------------------------------------------------------------- |
| `po-status-a.wav`       | "What's the status of purchase order P O dash one zero four eight two?"   |
| `po-status-b.wav`       | "What's the status of purchase order P O dash two zero nine three one?"   |
| `interrupt.wav`         | "Wait, stop."                                                             |
| `followup-delivery.wav` | "And the delivery date?"                                                  |
| `silence-3s.wav`        | Nothing: exactly 3 seconds of silence (generate it rather than record it) |

- Read the PO codes digit by digit, exactly as written. They are PO-10482 and PO-20931.
- Record "Wait, stop." on its own. The clip player starts it a set delay after the agent begins speaking.
- Speak at a normal pace and volume, as you would on a phone call.

## Check

Each file must report `s16,16000,1`:

```bash
for f in *.wav; do
  ffprobe -v error -show_entries stream=sample_fmt,sample_rate,channels -of csv=p=0 "$f" | sed "s|^|$f: |"
done
```
