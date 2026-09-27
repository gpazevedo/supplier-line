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

## Round 2: what to re-record

The first take had two problems:

- `po-status-b.wav` fails. The caller paused before the last digit, and Sonic guessed it: it looked up PO-20933 instead of PO-20931.
- All four speech clips carry room noise at about −26 dBFS, only about 10 dB below the speech. It sounds like a fan, air conditioner or computer, or the mic gain set too high.

Re-record all four speech clips in one sitting, so they share the same mic, room and level. Keep `silence-3s.wav`.

| File                    | Priority    | Say                                                                     |
| ----------------------- | ----------- | ----------------------------------------------------------------------- |
| `po-status-b.wav`       | Required    | "What's the status of purchase order P O dash two zero nine three one?" |
| `po-status-a.wav`       | Recommended | "What's the status of purchase order P O dash one zero four eight two?" |
| `interrupt.wav`         | Recommended | "Wait, stop."                                                           |
| `followup-delivery.wav` | Recommended | "And the delivery date?"                                                |

- Say the five digits at an even pace, with no pause longer than between ordinary words. A longer gap lets Sonic end your turn early.
- Turn off fans, air conditioning and other noise sources. Keep the mic close to your mouth and lower its gain, rather than raising the gain and speaking softly.
- Aim for speech peaks between −6 and −3 dB, with background noise below −50 dB.
- Record a few seconds first and run the level check below, before recording all four clips.

## Check

Each file must report `s16,16000,1`:

```bash
for f in *.wav; do
  ffprobe -v error -show_entries stream=sample_fmt,sample_rate,channels -of csv=p=0 "$f" | sed "s|^|$f: |"
done
```

Levels: `max` should be between −6 and −3 dB. `noise` is the quietest 250 ms stretch of the recording itself, which measures the background between words. It leaves out any digital-silence padding and the stretch where the padding meets the recording. It should be below −50 dB. The first take measured about −27 dB:

```bash
for f in po-status-a po-status-b interrupt followup-delivery; do
  max=$(ffmpeg -hide_banner -nostats -i $f.wav -af volumedetect -f null - 2>&1 | grep -oP 'max_volume: \K-?[0-9.]+')
  noise=$(ffmpeg -hide_banner -nostats -i $f.wav -af "asetnsamples=n=4000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null - 2>&1 \
    | grep -oP 'RMS_level=\K-?[0-9.]+' | awk '$1 > -80' | sed '1d;$d' | sort -g | head -1)
  echo "$f: max ${max} dB, noise ${noise} dB"
done
```
