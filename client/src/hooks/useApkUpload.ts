import { useState, useRef, useCallback } from 'react';
import { api } from '../services/api.js';
import type { ProcessingStage } from '../types/index.js';

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB

export function useApkUpload(onSuccess: (sessionId: string, filename: string, partialJadx?: boolean) => void) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ProcessingStage>('idle');
  const [progress, setProgress] = useState(0); // 0 - 100
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const cancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStage('idle');
    setProgress(0);
    setErrorMessage('Upload was cancelled.');
  }, []);

  const selectFile = useCallback((file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setErrorMessage(null);
      return;
    }

    if (!file.name.toLowerCase().endsWith('.apk')) {
      setErrorMessage('Selected file must have an .apk extension');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setErrorMessage(null);
    setProgress(0);
    setStage('idle');
  }, []);

  const startUpload = useCallback(async () => {
    if (!selectedFile) return;

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setErrorMessage(null);
    setStage('preparing');
    setProgress(0);

    const fileSize = selectedFile.size;
    const chunksCount = Math.ceil(fileSize / CHUNK_SIZE) || 1;
    setTotalChunks(chunksCount);
    setCurrentChunk(0);

    try {
      // 1. Initialize session
      const initData = await api.initUpload({
        filename: selectedFile.name,
        size: fileSize,
        chunks: chunksCount,
      });

      const sessionId = initData.sessionId;

      // 2. Upload chunks sequentially
      setStage('uploading');
      for (let i = 0; i < chunksCount; i++) {
        if (signal.aborted) {
          throw new Error('Upload aborted by user');
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(fileSize, start + CHUNK_SIZE);
        const chunkBlob = selectedFile.slice(start, end);

        setCurrentChunk(i + 1);
        await api.uploadChunk(sessionId, i, chunkBlob, signal);

        // Upload progress accounts for first 60% of total flow
        const percent = Math.round(((i + 1) / chunksCount) * 60);
        setProgress(percent);
      }

      // 3. Complete and trigger backend processing
      setStage('joining');
      setProgress(65);

      // Simulate step-wise progress while server completes pipeline
      const progressTimer = setInterval(() => {
        setProgress((prev) => {
          if (prev < 90) return prev + 5;
          return prev;
        });
      }, 1500);

      const completeResult = await api.completeUpload(sessionId, signal);
      clearInterval(progressTimer);

      setProgress(100);
      setStage('ready');

      onSuccess(sessionId, selectedFile.name, completeResult.partialJadx);
    } catch (err) {
      if (signal.aborted) {
        setErrorMessage('Upload cancelled.');
      } else {
        setErrorMessage((err as Error).message);
      }
      setStage('failed');
    } finally {
      abortControllerRef.current = null;
    }
  }, [selectedFile, onSuccess]);

  const reset = useCallback(() => {
    setSelectedFile(null);
    setStage('idle');
    setProgress(0);
    setCurrentChunk(0);
    setTotalChunks(0);
    setErrorMessage(null);
  }, []);

  return {
    selectedFile,
    selectFile,
    stage,
    progress,
    currentChunk,
    totalChunks,
    errorMessage,
    formatFileSize,
    startUpload,
    cancelUpload,
    reset,
    isUploading: stage === 'preparing' || stage === 'uploading' || stage === 'joining' || stage === 'validating' || stage === 'apktool' || stage === 'jadx' || stage === 'manifest',
  };
}
