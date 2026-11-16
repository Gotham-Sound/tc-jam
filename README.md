# TC Jam

A running timecode display for a script supervisor's phone. Jam it to the set's
timecode, then tap to keep a running list of cues stamped with timecode.

Accuracy target is one second. Rejam every few hours.

## Use

1. Pick the project frame rate.
2. Tap **Jam**, enter a time a few seconds ahead of the counter you are
   jamming to (slate, recorder, sync box), and hit **JAM** as the counter
   reaches it. Trim by a frame or a second if needed.
3. Tap the clock to mark a cue. Add a note afterwards if you want one.
4. **Export** shares, copies, or downloads the list as CSV.

The status line shows how long ago the jam was. It turns amber after 4 hours
and red after 8.

## How it keeps time

The clock is computed, not counted: at the jam it records which timecode frame
corresponds to which instant, and from then on derives the current frame from
elapsed time at the true frame rate. At 23.976 and 29.97 that is 1000/1001 of
nominal, so timecode correctly falls behind real time by 3.6 seconds per hour.
29.97 DF uses drop-frame counting.

It only tracks free-run or time-of-day timecode, not record-run.

Elapsed time comes from the phone's wall clock, so the jam survives a locked
screen or a reload. If the phone's clock gets stepped while the app is open,
the status line says to rejam.

The jam and the cue list are saved in the browser on that phone. Nothing is
sent anywhere.

## Not built yet

- Camera jam: read the counter from live video instead of typing it in.

## Develop

Static files, no build step. `node test.js` runs the timecode math tests.
