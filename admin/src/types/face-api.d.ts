// Minimal type declarations for face-api.js
// Full types are not published — we declare only what we use
declare module 'face-api.js' {
  export class TinyFaceDetectorOptions {
    constructor(opts?: { inputSize?: number; scoreThreshold?: number });
  }

  export interface FaceLandmarks68 {
    getNose(): Array<{ x: number; y: number }>;
    getLeftEye(): Array<{ x: number; y: number }>;
    getRightEye(): Array<{ x: number; y: number }>;
    getJawOutline(): Array<{ x: number; y: number }>;
    getLeftEyeBrow(): Array<{ x: number; y: number }>;
    getRightEyeBrow(): Array<{ x: number; y: number }>;
    getMouth(): Array<{ x: number; y: number }>;
    positions: Array<{ x: number; y: number }>;
  }

  export interface WithFaceDescriptor {
    descriptor: Float32Array;
  }

  export interface WithFaceLandmarks {
    landmarks: FaceLandmarks68;
  }

  export interface FaceDetection {
    score: number;
    box: { x: number; y: number; width: number; height: number };
  }

  export interface FullFaceDescription extends WithFaceDescriptor, WithFaceLandmarks {
    detection: FaceDetection;
  }

  export interface DetectionBuilderWithLandmarks extends Promise<(WithFaceLandmarks & { detection: FaceDetection }) | undefined> {
    withFaceDescriptor(): Promise<FullFaceDescription | undefined>;
  }

  export interface DetectionBuilder extends Promise<FaceDetection | undefined> {
    withFaceLandmarks(useTinyModel?: boolean): DetectionBuilderWithLandmarks;
    withFaceDescriptor(): Promise<FullFaceDescription | undefined>;
  }

  export interface MultiDetectionBuilderWithLandmarks extends Promise<(WithFaceLandmarks & { detection: FaceDetection })[]> {
    withFaceDescriptors(): Promise<FullFaceDescription[]>;
  }

  export interface MultiDetectionBuilder extends Promise<FaceDetection[]> {
    withFaceLandmarks(useTinyModel?: boolean): MultiDetectionBuilderWithLandmarks;
    withFaceDescriptors(): Promise<FullFaceDescription[]>;
  }

  export function detectSingleFace(
    input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
    options?: TinyFaceDetectorOptions
  ): DetectionBuilder;

  export function detectAllFaces(
    input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
    options?: TinyFaceDetectorOptions
  ): MultiDetectionBuilder;

  export const nets: {
    tinyFaceDetector: { loadFromUri(url: string): Promise<void> };
    faceLandmark68TinyNet: { loadFromUri(url: string): Promise<void> };
    faceLandmark68Net: { loadFromUri(url: string): Promise<void> };
    faceRecognitionNet: { loadFromUri(url: string): Promise<void> };
    ssdMobilenetv1: { loadFromUri(url: string): Promise<void> };
  };

  export class FaceMatcher {
    constructor(inputs: LabeledFaceDescriptors[] | Float32Array | Float32Array[], distanceThreshold?: number);
    findBestMatch(descriptor: Float32Array): FaceMatch;
  }

  export class FaceMatch {
    label: string;
    distance: number;
    toString(withDistance?: boolean): string;
  }

  export class LabeledFaceDescriptors {
    constructor(label: string, descriptors: Float32Array[]);
    label: string;
    descriptors: Float32Array[];
  }

  export function euclideanDistance(a: Float32Array | number[], b: Float32Array | number[]): number;
}
