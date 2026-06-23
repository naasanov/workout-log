// NOTE: BarcodeScanner requires a secure context (HTTPS or localhost).
// getUserMedia will be denied on plain HTTP pages in production.

import { useEffect, useRef } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import styles from './BarcodeScanner.module.scss';

interface BarcodeScannerProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Keep refs so the cleanup closure can stop everything even after unmount.
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectedRef = useRef(false);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    let cancelled = false;

    async function start() {
      try {
        // Request environment-facing (rear) camera explicitly.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;

        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;

        const controls = await reader.decodeFromVideoDevice(
          undefined,
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
