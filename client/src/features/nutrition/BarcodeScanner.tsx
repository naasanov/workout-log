// NOTE: BarcodeScanner requires a secure context (HTTPS or localhost).
// getUserMedia will be denied on plain HTTP pages in production.

import { useEffect, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import styles from './BarcodeScanner.module.scss';

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

// Restrict decoding to retail product barcode formats. Scanning fewer
// formats per frame is faster and meaningfully more reliable than the
// default (which tries every supported format, including 2D formats
// we never expect from a "scan barcode" product lookup flow).
const PRODUCT_BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
];

const hints = new Map<DecodeHintType, unknown>();
hints.set(DecodeHintType.POSSIBLE_FORMATS, PRODUCT_BARCODE_FORMATS);

export default function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Keep refs so the cleanup closure can stop everything even after unmount.
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectedRef = useRef(false);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(hints);
    readerRef.current = reader;

    let cancelled = false;

    async function start() {
      try {
        // Request environment-facing (rear) camera explicitly, at as high
        // a resolution as the device supports. `ideal` (not `exact`) lets
        // this degrade gracefully on devices that can't hit 1080p — but on
        // capable phones a higher-res frame is the single biggest win for
        // 1D barcode decode reliability on iOS Safari.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;

        // Decode from the single stream we already acquired above, rather
        // than calling decodeFromVideoDevice (which would open a *second*
        // getUserMedia stream on top of this one).
        const controls = await reader.decodeFromStream(
          stream,
          videoRef.current,
          (result, _err, ctrl) => {
            if (result && !detectedRef.current) {
              detectedRef.current = true;
              // Stop scanning; let the parent handle the detected code.
              ctrl.stop();
              stream.getTracks().forEach(t => t.stop());
              onDetected(result.getText());
            }
          },
        );

        if (cancelled) {
          controls.stop();
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        controlsRef.current = controls;
      } catch (err) {
        // Camera permission denied or not available — just close.
        console.error('[BarcodeScanner] camera error:', err);
        if (!cancelled) onClose();
      }
    }

    start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.viewfinder}>
          {/* playsInline is essential for iOS Safari; muted prevents autoplay policy block */}
          <video
            ref={videoRef}
            className={styles.video}
            playsInline
            muted
            autoPlay
          />
          {/* Framing reticle */}
          <div className={styles.reticle}>
            <svg
              viewBox="0 0 200 200"
              className={styles.reticleSvg}
              aria-hidden="true"
            >
              {/* Four corner brackets */}
              <polyline points="0,40 0,0 40,0" fill="none" stroke="#70EB70" strokeWidth="4" strokeLinecap="round" />
              <polyline points="160,0 200,0 200,40" fill="none" stroke="#70EB70" strokeWidth="4" strokeLinecap="round" />
              <polyline points="200,160 200,200 160,200" fill="none" stroke="#70EB70" strokeWidth="4" strokeLinecap="round" />
              <polyline points="40,200 0,200 0,160" fill="none" stroke="#70EB70" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <p className={styles.hint}>Point camera at a barcode</p>

        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close barcode scanner"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
