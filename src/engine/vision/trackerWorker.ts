import { Tracker, type TrackerModu, type TrackerOptions } from './tracker.ts';

type Request =
  | { type: 'init'; options: TrackerOptions }
  | { type: 'frame'; frame: ImageBitmap; generation: number }
  | { type: 'reset' }
  | { type: 'mode'; mode: TrackerModu };

let tracker = new Tracker({ everyNFrames: 1 });

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === 'init') {
    tracker = new Tracker({ ...request.options, everyNFrames: 1 });
    return;
  }
  if (request.type === 'reset') {
    tracker.reset();
    return;
  }
  if (request.type === 'mode') {
    tracker.setMod(request.mode);
    return;
  }

  try {
    const targets = tracker.step(request.frame);
    self.postMessage({
      type: 'result',
      generation: request.generation,
      targets,
      status: tracker.status,
    });
  } finally {
    request.frame.close();
  }
};
