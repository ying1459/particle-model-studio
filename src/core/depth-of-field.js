const DEFAULT_DEPTH_OF_FIELD_LENS = Object.freeze({
  aperture: 2.8,
  focalLength: 50,
  focusDistance: 5,
  sensorWidth: 36,
  bokehScale: 2.35,
  width: 1920,
  height: 1080
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeDepthOfFieldLensParams(params = {}) {
  const focalLength = clamp(
    finiteNumber(params.focalLength, DEFAULT_DEPTH_OF_FIELD_LENS.focalLength),
    1,
    300
  );
  const focalLengthMeters = focalLength * 0.001;
  return {
    aperture: clamp(finiteNumber(params.aperture, DEFAULT_DEPTH_OF_FIELD_LENS.aperture), 0.7, 64),
    focalLength,
    focusDistance: Math.max(
      focalLengthMeters + 0.01,
      finiteNumber(params.focusDistance, DEFAULT_DEPTH_OF_FIELD_LENS.focusDistance)
    ),
    sensorWidth: Math.max(8, finiteNumber(params.sensorWidth, DEFAULT_DEPTH_OF_FIELD_LENS.sensorWidth)),
    bokehScale: clamp(finiteNumber(params.bokehScale, DEFAULT_DEPTH_OF_FIELD_LENS.bokehScale), 0.25, 6),
    width: Math.max(2, Math.floor(finiteNumber(params.width, DEFAULT_DEPTH_OF_FIELD_LENS.width))),
    height: Math.max(2, Math.floor(finiteNumber(params.height, DEFAULT_DEPTH_OF_FIELD_LENS.height)))
  };
}

export function getMaximumBokehRadiusPixels(width, height) {
  const safeWidth = Math.max(2, finiteNumber(width, DEFAULT_DEPTH_OF_FIELD_LENS.width));
  const safeHeight = Math.max(2, finiteNumber(height, DEFAULT_DEPTH_OF_FIELD_LENS.height));
  return clamp(Math.min(safeWidth, safeHeight) * 0.09, 10, 82);
}

export function getThinLensCircleOfConfusionPixels(viewDistance, params = {}) {
  const lens = normalizeDepthOfFieldLensParams(params);
  const focalLength = lens.focalLength * 0.001;
  const objectDistance = Math.max(focalLength + 0.001, finiteNumber(viewDistance, lens.focusDistance));
  const apertureDiameter = focalLength / lens.aperture;
  const sensorWidth = lens.sensorWidth * 0.001;
  const cocOnSensor = apertureDiameter * focalLength * (objectDistance - lens.focusDistance) /
    (objectDistance * Math.max(lens.focusDistance - focalLength, 0.001));
  const radiusPixels = cocOnSensor / sensorWidth * lens.width * 0.5 * lens.bokehScale;
  const maximumRadius = getMaximumBokehRadiusPixels(lens.width, lens.height);
  return clamp(radiusPixels, -maximumRadius, maximumRadius);
}

