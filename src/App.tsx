/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Leaf, 
  Maximize, 
  Database, 
  Activity, 
  Ruler,
  Camera,
  Download,
  RefreshCw,
  FlipHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AnalysisData {
  area: number;
  width: number;
  height: number;
  pixelsPerCm: number;
  isProcessed: boolean;
}

export default function App() {
  const [isLive, setIsLive] = useState(true);
  const [pixelsPerCm, setPixelsPerCm] = useState<number>(100);
  const focalLengthConstant = 800;
  const [distance, setDistance] = useState<number | string>('');

  const handleDistanceChange = (val: string) => {
    setDistance(val);
    const numDist = parseFloat(val);
    if (numDist > 0) {
      const calculatedScale = parseFloat((focalLengthConstant / numDist).toFixed(2));
      setPixelsPerCm(calculatedScale);
    }
  };

  const [analysis, setAnalysis] = useState<AnalysisData>({
    area: 0,
    width: 0,
    height: 0,
    pixelsPerCm: 100,
    isProcessed: false
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [history, setHistory] = useState<AnalysisData[]>([]);
  const [isCameraLoading, setIsCameraLoading] = useState(true);

  // Camera Management
  const getDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
      setDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedDeviceId) {
        // Prefer environment camera by default if available
        const backCam = videoDevices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
        setSelectedDeviceId(backCam ? backCam.deviceId : videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error("Error enumerating devices:", err);
    }
  }, [selectedDeviceId]);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      setIsCameraLoading(true);
      // Stop any existing stream first
      stopCamera();

      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId 
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } }
          : { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Refresh device list to get labels (labels are empty until permission is granted)
      getDevices();
      setIsCameraLoading(false);
    } catch (err: any) {
      console.error("Camera Error:", err);
      setIsCameraLoading(false);
      if (err.name === 'NotAllowedError') {
        setError("Camera permission denied. Please enable camera access in your browser settings.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError("No camera found. If using a Bluetooth or external camera, ensure it is properly connected and recognized by your system.");
      } else {
        setError("Could not connect to camera. Please check your hardware connections.");
      }
    }
  }, [selectedDeviceId, getDevices]);

  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const switchCamera = () => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex(d => d.deviceId === selectedDeviceId);
    const nextIndex = (currentIndex + 1) % devices.length;
    setSelectedDeviceId(devices[nextIndex].deviceId);
  };

  useEffect(() => {
    getDevices();
  }, [getDevices]);

  useEffect(() => {
    if (isLive) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isLive, startCamera, stopCamera]);

  // Capture and Process
  const capturePhoto = async () => {
    const video = videoRef.current;
    const hiddenCanvas = hiddenCanvasRef.current;
    if (!video || !hiddenCanvas) return;

    setIsProcessing(true);
    setIsLive(false);

    // High-Res Capture
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    const hctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
    if (!hctx) return;
    hctx.drawImage(video, 0, 0);

    // Trigger Analysis
    setTimeout(() => processCapturedFrame(), 100);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setIsLive(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const hiddenCanvas = hiddenCanvasRef.current;
        if (!hiddenCanvas) return;

        hiddenCanvas.width = img.width;
        hiddenCanvas.height = img.height;
        const hctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
        if (!hctx) return;

        hctx.clearRect(0, 0, hiddenCanvas.width, hiddenCanvas.height);
        hctx.drawImage(img, 0, 0);
        
        processCapturedFrame();
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const processCapturedFrame = useCallback(() => {
    const hiddenCanvas = hiddenCanvasRef.current;
    const displayCanvas = canvasRef.current;
    if (!hiddenCanvas || !displayCanvas) return;

    const hctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
    if (!hctx) return;

    const width = hiddenCanvas.width;
    const height = hiddenCanvas.height;

    // Display Scaling
    const dpr = window.devicePixelRatio || 1;
    const containerWidth = displayCanvas.parentElement?.clientWidth || 800;
    const scale = containerWidth / width;
    displayCanvas.width = width * scale * dpr;
    displayCanvas.height = height * scale * dpr;
    const dctx = displayCanvas.getContext('2d');
    if (!dctx) return;
    dctx.scale(scale * dpr, scale * dpr);

    // 1. Analyze Pixels (Simple Green Detection)
    const imageData = hctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let leafPixels = 0;
    let minX = width, maxX = 0, minY = height, maxY = 0;
    const points: {x: number, y: number}[] = [];

    const step = Math.max(1, Math.floor(width / 500));
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        if (g > r * 1.15 && g > b * 1.15 && g > 45) {
          leafPixels += step * step;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (Math.random() < 0.15) points.push({x, y});
        }
      }
    }

    // 2. Calculate Results
    const cmPerPixel = 1 / pixelsPerCm;
    const areaCm2 = leafPixels * (cmPerPixel ** 2);
    const widthCm = (maxX - minX) * cmPerPixel;
    const heightCm = (maxY - minY) * cmPerPixel;

    setAnalysis({
      area: areaCm2,
      width: widthCm,
      height: heightCm,
      pixelsPerCm,
      isProcessed: true
    });

    // Add to history
    setHistory(prev => [{
      area: areaCm2,
      width: widthCm,
      height: heightCm,
      pixelsPerCm,
      isProcessed: true
    }, ...prev].slice(0, 10)); // Keep last 10

    // 3. Draw Visuals
    dctx.drawImage(hiddenCanvas, 0, 0, width, height);
    drawOxyGrid(dctx, width, height);
    
    if (points.length > 0) {
      drawGlowingContour(dctx, points, minX, maxX, minY, maxY);
      drawLobeTips(dctx, minX, maxX, minY, maxY);
    }

    setIsProcessing(false);
  }, [pixelsPerCm]);

  const drawOxyGrid = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 0.5;
    const spacing = 100;
    for (let x = 0; x < w; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    
    // Central Crosshair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w/2 - 20, h/2); ctx.lineTo(w/2 + 20, h/2);
    ctx.moveTo(w/2, h/2 - 20); ctx.lineTo(w/2, h/2 + 20);
    ctx.stroke();
  };

  const drawGlowingContour = (ctx: CanvasRenderingContext2D, points: {x: number, y: number}[], minX: number, maxX: number, minY: number, maxY: number) => {
    ctx.strokeStyle = '#228B22';
    ctx.lineWidth = 4;
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#228B22';
    ctx.beginPath();
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    points.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const drawLobeTips = (ctx: CanvasRenderingContext2D, minX: number, maxX: number, minY: number, maxY: number) => {
    const tips = [
      {x: minX, y: (minY + maxY)/2, label: 'L'},
      {x: maxX, y: (minY + maxY)/2, label: 'R'},
      {x: (minX + maxX)/2, y: minY, label: 'T'},
      {x: (minX + maxX)/2, y: maxY, label: 'B'}
    ];
    tips.forEach(tip => {
      ctx.fillStyle = 'white';
      ctx.strokeStyle = '#228B22';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = '#1A472A';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(`(${Math.round(tip.x)}, ${Math.round(tip.y)})`, tip.x + 12, tip.y);
    });
  };

  const exportReport = () => {
    if (!analysis.isProcessed) return;
    const report = {
      timestamp: new Date().toISOString(),
      area_cm2: analysis.area,
      width_cm: analysis.width,
      height_cm: analysis.height,
      pixels_per_cm: analysis.pixelsPerCm,
      device: devices.find(d => d.deviceId === selectedDeviceId)?.label || 'Unknown'
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slas_report_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] flex items-center justify-center p-4 lg:p-6 font-sans text-neutral-900 overflow-y-auto">
      
      {/* Main Container */}
      <div className="w-full max-w-6xl min-h-[90vh] lg:h-[85vh] bg-white rounded-[2rem] shadow-[0_20px_60px_rgba(0,0,0,0.08)] overflow-hidden flex flex-col lg:flex-row border border-neutral-100 relative">
        
        {/* Left: Display Area (Live or Captured) */}
        <div className="flex-grow h-[50vh] lg:h-full bg-[#F8F9F8] relative overflow-hidden flex items-center justify-center">
          <canvas ref={hiddenCanvasRef} className="hidden" />
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleFileUpload}
          />
          
          {isLive ? (
            <div className="w-full h-full relative">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover"
              />
              
              {/* Camera Loading State */}
              <AnimatePresence>
                {isCameraLoading && (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-white z-10 flex flex-col items-center justify-center gap-4"
                  >
                    <div className="w-10 h-10 border-4 border-neutral-100 border-t-[#228B22] rounded-full animate-spin" />
                    <p className="text-[10px] font-black text-neutral-400 tracking-widest uppercase">Initializing Sensor...</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Live Overlay */}
              <div className="absolute inset-0 pointer-events-none border-[20px] border-white/10" />
              <div className="absolute top-8 left-8 flex flex-col gap-2 z-20">
                <div className="bg-white/90 backdrop-blur px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] font-black tracking-widest text-[#1A472A] shadow-sm">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  LIVE SENSOR FEED
                </div>
                {devices.length > 1 && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); switchCamera(); }}
                    className="pointer-events-auto bg-[#1A472A] text-white px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] font-black tracking-widest shadow-lg hover:bg-[#228B22] transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    SWITCH CAMERA
                  </button>
                )}
                <div className="bg-white/70 backdrop-blur px-3 py-1 rounded-full flex items-center gap-2 text-[9px] font-bold text-neutral-500 shadow-sm border border-white/20">
                  <Camera className="w-3 h-3" />
                  {devices.find(d => d.deviceId === selectedDeviceId)?.label || 'Detecting Hardware...'}
                </div>
              </div>
              {/* Corner Marks */}
              <div className="absolute top-12 left-12 w-12 h-12 border-t-2 border-l-2 border-white/40" />
              <div className="absolute top-12 right-12 w-12 h-12 border-t-2 border-r-2 border-white/40" />
              <div className="absolute bottom-12 left-12 w-12 h-12 border-b-2 border-l-2 border-white/40" />
              <div className="absolute bottom-12 right-12 w-12 h-12 border-b-2 border-r-2 border-white/40" />
              
              {/* Central Crosshair */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 pointer-events-none">
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-white/40" />
                <div className="absolute left-1/2 top-0 w-0.5 h-full bg-white/40" />
              </div>
            </div>
          ) : (
            <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />
          )}

          {/* Error State */}
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-white/90 backdrop-blur-md z-50 flex flex-col items-center justify-center p-10 text-center"
              >
                <div className="bg-red-50 text-red-600 p-8 rounded-3xl border border-red-100 max-w-md shadow-xl">
                  <RefreshCw className="w-12 h-12 mb-4 mx-auto opacity-50" />
                  <h2 className="text-xl font-black mb-2 uppercase tracking-tighter">Hardware Connection Error</h2>
                  <p className="text-sm leading-relaxed mb-6">{error}</p>
                  <button 
                    onClick={startCamera}
                    className="w-full bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-colors"
                  >
                    Retry Connection
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Processing Loader */}
          <AnimatePresence>
            {isProcessing && (
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-white/60 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-4"
              >
                <div className="w-12 h-12 border-4 border-[#228B22] border-t-transparent rounded-full animate-spin" />
                <p className="text-xs font-black text-[#228B22] tracking-widest uppercase">Analyzing Sample...</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Sidebar (Glassmorphism) */}
        <div className="w-full lg:w-96 bg-white/80 backdrop-blur-xl border-l border-neutral-100 flex flex-col z-10 h-[50vh] lg:h-full">
          
          <div className="flex-grow overflow-y-auto p-6 lg:p-10 space-y-8 lg:space-y-10 custom-scrollbar">
            {/* Branding */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-[#228B22] p-2 rounded-lg shadow-lg shadow-green-100">
                  <Leaf className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-2xl font-black text-[#1A472A] tracking-tighter">SLAS</h1>
              </div>
              <p className="text-[10px] font-bold text-[#228B22] tracking-[0.2em] uppercase">Smart Leaf Area Scanner</p>
            </div>

            {/* Controls */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-neutral-400">
                <Activity className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Controls</span>
              </div>

              <div className="space-y-4">
                {isLive ? (
                  <div className="grid grid-cols-1 gap-3">
                    <button 
                      onClick={capturePhoto}
                      className="w-full bg-[#1A472A] hover:bg-[#228B22] text-white py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 shadow-xl shadow-green-100 transition-all"
                    >
                      <Camera className="w-5 h-5" />
                      Capture Frame
                    </button>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-600 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 transition-all"
                    >
                      <Download className="w-5 h-5 rotate-180" />
                      Upload Image
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    <button 
                      onClick={() => setIsLive(true)}
                      className="w-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 transition-all"
                    >
                      <FlipHorizontal className="w-5 h-5" />
                      Retake Sample
                    </button>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-600 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 transition-all"
                    >
                      <Download className="w-5 h-5 rotate-180" />
                      Upload New Image
                    </button>
                  </div>
                )}

                <div className="bg-neutral-50 rounded-2xl p-4 border border-neutral-100 space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Maximize className="w-3 h-3 text-neutral-400" />
                      <span className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest">Distance to Object</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input 
                        type="number" 
                        placeholder="Enter distance..."
                        value={distance}
                        onChange={(e) => handleDistanceChange(e.target.value)}
                        className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-green-500/20"
                      />
                      <span className="text-[10px] font-bold text-neutral-400 whitespace-nowrap">CM</span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-neutral-200/50">
                    <div className="flex items-center gap-2 mb-3">
                      <Ruler className="w-3 h-3 text-neutral-400" />
                      <span className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest">Reference Scale</span>
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                      <input 
                        type="number" 
                        value={pixelsPerCm}
                        onChange={(e) => setPixelsPerCm(Number(e.target.value))}
                        className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-green-500/20"
                      />
                      <span className="text-[10px] font-bold text-neutral-400 whitespace-nowrap">PX / 1CM</span>
                    </div>
                    <p className="text-[8px] font-medium text-neutral-400 leading-tight italic">
                      * Auto-calculated from distance or set manually.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Analysis Results */}
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2 text-neutral-400">
                <Database className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Analysis Results</span>
              </div>

              <div className="space-y-4">
                <div className="bg-[#F8F9F8] rounded-2xl p-6 border border-neutral-100 group transition-all hover:bg-white hover:shadow-xl hover:shadow-green-50/50">
                  <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-widest block mb-2">Total Surface Area</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-light text-[#1A472A]">{analysis.area.toFixed(2)}</span>
                    <span className="text-sm font-bold text-[#228B22]">cm²</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#F8F9F8] rounded-2xl p-5 border border-neutral-100">
                    <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-widest block mb-1">Max Width</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold text-[#1A472A]">{analysis.width.toFixed(2)}</span>
                      <span className="text-[10px] font-bold text-neutral-400">cm</span>
                    </div>
                  </div>
                  <div className="bg-[#F8F9F8] rounded-2xl p-5 border border-neutral-100">
                    <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-widest block mb-1">Max Height</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold text-[#1A472A]">{analysis.height.toFixed(2)}</span>
                      <span className="text-[10px] font-bold text-neutral-400">cm</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Scan History */}
            {history.length > 0 && (
              <div className="flex flex-col gap-6">
                <div className="flex items-center gap-2 text-neutral-400">
                  <RefreshCw className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Scan History</span>
                </div>
                <div className="space-y-3">
                  {history.map((item, idx) => (
                    <div key={idx} className="bg-neutral-50 rounded-xl p-3 border border-neutral-100 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[8px] font-bold text-neutral-400 uppercase">Scan #{history.length - idx}</span>
                        <span className="text-xs font-bold text-[#1A472A]">{item.area.toFixed(2)} cm²</span>
                      </div>
                      <div className="text-[8px] font-medium text-neutral-400 text-right">
                        W: {item.width.toFixed(1)}cm<br/>
                        H: {item.height.toFixed(1)}cm
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 lg:p-10 border-t border-neutral-100 bg-white/50">
            <button 
              onClick={exportReport}
              disabled={!analysis.isProcessed}
              className={`w-full py-4 rounded-2xl font-bold text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all ${
                analysis.isProcessed 
                  ? 'bg-neutral-50 hover:bg-neutral-100 text-neutral-600' 
                  : 'bg-neutral-50 text-neutral-300 cursor-not-allowed'
              }`}
            >
              <Download className="w-4 h-4" />
              Export Report
            </button>
          </div>
        </div>

        {/* Smartphone Notch Detail */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-neutral-100 rounded-b-2xl z-50 flex items-center justify-center gap-2 border-x border-b border-neutral-200">
          <div className="w-1.5 h-1.5 rounded-full bg-neutral-200"></div>
          <div className="w-12 h-1 bg-neutral-200 rounded-full"></div>
        </div>

      </div>
    </div>
  );
}
