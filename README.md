# TC Jam

A running timecode display for a script supervisor's phone. Jam it to the set's
timecode, then tap to keep a running list of cues stamped with timecode.

Accuracy target is one second. Rejam every few hours.

## Use

1. Pick the project frame rate.
2. Tap **Jam**, then **Jam from camera**. Fill the box with the counter you
   are jamming to (slate, recorder, sync box) and hold steady for a few
   seconds. When it locks, check that "This phone will show" matches the
   counter and tap **USE THIS JAM**. Zoom buttons help with small displays.
   Or jam by hand: enter a time a few seconds ahead of the counter and hit
   **JAM** as the counter reaches it. Trim by a frame or a second if needed.
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

## How camera jam works

Each video frame is cropped to the guide box and read on the phone (nothing is
uploaded). Only the hours, minutes, and seconds are trusted. One reading pins
the counter to within a second; readings taken at different moments within the
second narrow that down, and misreads are outvoted. It locks once at least six
readings over 1.5 seconds agree to within 0.4 s.

Against a handheld clip of a Denecke SB-4 it locks in about 3 seconds and
lands within 0.1 s. Other displays, LED slates in particular, are untested.

The reader is Tesseract.js with the `tessdata_fast` English model, both
Apache 2.0, vendored under `vendor/tesseract` so it works offline after the
first camera jam. The `fast` model matters: the `best_int` model misreads 9 as
0 on dot-matrix displays.

## Develop

Static files, no build step. `node test.js` runs the timecode math and jam
solver tests. Opening the page with `?testvideo=clip.mp4` runs camera jam
against a video file instead of the camera.
