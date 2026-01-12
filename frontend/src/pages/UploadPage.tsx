import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { UploadInfo } from '../services/api';
import './UploadPage.css';

type PhotoSize = 'large' | 'small';
type PhotoType = 'normal' | 'polaroid';

interface SelectedFile {
  file: File;
  preview: string;
  uploading: boolean;
  uploaded: boolean;
  error?: string;
  previewError?: boolean;
}

interface UploadedImage {
  id: string;
  fileName: string;
  originalName: string;
  s3Url: string;
  photoSize: PhotoSize;
  photoType: PhotoType;
  uploadedAt: string;
  orientation?: 'landscape' | 'portrait' | 'square';
}

export function UploadPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Selection state - locked once confirmed
  const [photoSize, setPhotoSize] = useState<PhotoSize>('small');
  const [photoType, setPhotoType] = useState<PhotoType>('normal');
  const [optionsConfirmed, setOptionsConfirmed] = useState(false);
  
  // Upload state
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Uploaded images
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [imageOrientations, setImageOrientations] = useState<Record<string, 'landscape' | 'portrait' | 'square'>>({});
  const [imageLoadFailures, setImageLoadFailures] = useState<Record<string, boolean>>({});
  
  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Detect image orientation when image loads
  const handleImageLoad = (imageId: string, event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const ratio = img.naturalWidth / img.naturalHeight;
    let orientation: 'landscape' | 'portrait' | 'square' = 'square';
    
    if (ratio > 1.1) {
      orientation = 'landscape';
    } else if (ratio < 0.9) {
      orientation = 'portrait';
    }
    
    setImageOrientations(prev => ({ ...prev, [imageId]: orientation }));
  };

  // Handle image load failure (common for unsupported formats like HEIC in some browsers)
  const handleImageError = (imageId: string) => {
    setImageLoadFailures(prev => ({ ...prev, [imageId]: true }));
    // Default to square to keep container sizing stable
    setImageOrientations(prev => ({ ...prev, [imageId]: 'square' }));
  };

  // Mark preview URL failure (for local previews before upload)
  const markPreviewError = (previewUrl: string) => {
    setSelectedFiles(prev => prev.map(f => 
      f.preview === previewUrl ? { ...f, previewError: true } : f
    ));
  };

  // Get CSS class for image based on size and orientation
  const getImageClass = (imageId: string): string => {
    const orientation = imageOrientations[imageId] || 'loading';
    const size = photoSize; // Use current selected size
    return `uploaded-card ${size}-${orientation}`;
  };

  useEffect(() => {
    if (token) {
      loadData(token);
    }
  }, [token]);

  const loadData = async (t: string) => {
    try {
      const [infoRes, imagesRes] = await Promise.all([
        api.validateUploadToken(t),
        api.getUploadedImages(t),
      ]);
      
      if (infoRes.success) {
        setInfo(infoRes);
        // Load saved print settings if available
        if (infoRes.photoSize) {
          setPhotoSize(infoRes.photoSize);
          setOptionsConfirmed(true);
        }
        if (infoRes.photoType) {
          setPhotoType(infoRes.photoType);
        }
      } else {
        setError(infoRes.error || 'Invalid or expired link');
      }
      
      if (imagesRes.success && imagesRes.images) {
        setUploadedImages(imagesRes.images);
      }
    } catch (err) {
      setError('Unable to validate link');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmOptions = async () => {
    if (!token) return;
    
    try {
      const result = await api.updatePrintSettings(token, photoSize, photoType);
      if (result.success) {
        setOptionsConfirmed(true);
        if (info) {
          setInfo({ ...info, photoSize, photoType });
        }
      } else {
        alert(result.error || 'Failed to save settings');
      }
    } catch (err) {
      alert('Failed to save settings');
    }
  };

  const handleChangeOptions = () => {
    if (selectedFiles.length > 0) {
      if (!confirm('Changing options will clear your selected photos. Continue?')) {
        return;
      }
      // Clear selected files
      selectedFiles.forEach(f => URL.revokeObjectURL(f.preview));
      setSelectedFiles([]);
    }
    setOptionsConfirmed(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) addFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files) addFiles(Array.from(files));
  };

  const isSupportedImage = (file: File) => {
    if (file.type.startsWith('image/')) return true;
    // Fallback on extension check for formats with missing/unknown MIME types (e.g., HEIC)
    return /\.(heic|heif|jpg|jpeg|png|gif|webp|bmp|tiff)$/i.test(file.name);
  };

  const addFiles = (files: File[]) => {
    if (!info) return;
    // Calculate remaining slots based on actual uploaded images
    const currentRemaining = Math.max(0, (info.maxUploads || 0) - uploadedImages.length);
    const remainingSlots = currentRemaining - selectedFiles.filter(f => !f.uploaded).length;
    const imageFiles = files.filter(isSupportedImage);
    const filesToAdd = imageFiles.slice(0, Math.max(0, remainingSlots));

    const newFiles: SelectedFile[] = filesToAdd.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      uploading: false,
      uploaded: false,
    }));

    setSelectedFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].preview);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const handleUpload = async () => {
    if (!token || selectedFiles.length === 0) return;

    setIsUploading(true);

    for (let i = 0; i < selectedFiles.length; i++) {
      if (selectedFiles[i].uploaded) continue;

      setSelectedFiles(prev => {
        const newFiles = [...prev];
        newFiles[i] = { ...newFiles[i], uploading: true };
        return newFiles;
      });

      try {
        const result = await api.uploadPhoto(token, selectedFiles[i].file, photoSize, photoType);
        
        if (result.success) {
          const newImage: UploadedImage = {
            id: Date.now().toString(),
            fileName: selectedFiles[i].file.name,
            originalName: selectedFiles[i].file.name,
            s3Url: selectedFiles[i].preview,
            photoSize,
            photoType,
            uploadedAt: new Date().toISOString(),
          };
          setUploadedImages(prev => [newImage, ...prev]);
        }
        
        setSelectedFiles(prev => {
          const newFiles = [...prev];
          newFiles[i] = { 
            ...newFiles[i], 
            uploading: false, 
            uploaded: result.success,
            error: result.success ? undefined : result.error,
          };
          return newFiles;
        });

        if (result.success && info) {
          setInfo({
            ...info,
            currentUploads: (info.currentUploads || 0) + 1,
            remainingUploads: (info.remainingUploads || 1) - 1,
          });
        }
      } catch (err) {
        setSelectedFiles(prev => {
          const newFiles = [...prev];
          newFiles[i] = { ...newFiles[i], uploading: false, error: 'Upload failed' };
          return newFiles;
        });
      }
    }

    setSelectedFiles(prev => prev.filter(f => !f.uploaded));
    
    if (token) {
      const imagesRes = await api.getUploadedImages(token);
      if (imagesRes.success && imagesRes.images) {
        setUploadedImages(imagesRes.images);
      }
    }

    setIsUploading(false);
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!token) return;
    
    if (!confirm('Are you sure you want to delete this photo?')) {
      return;
    }

    setDeletingImageId(imageId);
    
    try {
      const result = await api.deleteImage(token, imageId);
      
      if (result.success) {
        setImageLoadFailures(prev => {
          const { [imageId]: _, ...rest } = prev;
          return rest;
        });
        setUploadedImages(prev => prev.filter(img => img.id !== imageId));
        if (info) {
          setInfo({
            ...info,
            currentUploads: Math.max(0, (info.currentUploads || 0) - 1),
            remainingUploads: (info.remainingUploads || 0) + 1,
          });
        }
      } else {
        alert(result.error || 'Failed to delete image');
      }
    } catch (err) {
      alert('Failed to delete image');
    } finally {
      setDeletingImageId(null);
    }
  };

  const handleSubmitForPrinting = () => {
    if (!token || !info) return;
    setShowConfirmModal(true);
  };

  const confirmSubmitForPrinting = async () => {
    if (!token || !info) return;
    
    setShowConfirmModal(false);
    setIsSubmitting(true);
    
    try {
      const result = await api.submitForPrinting(token);
      
      if (result.success) {
        setInfo({
          ...info,
          submittedForPrinting: true,
          submittedAt: new Date().toISOString(),
        });
      } else {
        alert(result.error || 'Failed to submit for printing');
      }
    } catch (err) {
      alert('Failed to submit for printing');
    } finally {
      setIsSubmitting(false);
    }
  };

  const pendingCount = selectedFiles.filter(f => !f.uploaded && !f.error).length;
  
  // Use uploadedImages.length as source of truth for actual uploaded count
  const actualUploaded = uploadedImages.length;
  const maxUploads = info?.maxUploads || 0;
  const actualRemaining = Math.max(0, maxUploads - actualUploaded);
  const allPhotosUploaded = actualUploaded >= maxUploads && maxUploads > 0;
  const isSubmitted = info?.submittedForPrinting;

  if (isLoading) {
    return (
      <div className="upload-page loading">
        <div className="loader"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="upload-page error-page">
        <div className="error-container">
          <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h1>Link Invalid</h1>
          <p>{error || 'This upload link is invalid or has expired.'}</p>
          <a href="https://photobookx.com" className="primary-btn">Visit PhotoBookX</a>
        </div>
      </div>
    );
  }

  // If already submitted, show success state
  if (isSubmitted) {
    return (
      <div className="upload-page">
        <header className="header">
          <img 
            src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
            alt="PhotoBookX" 
            className="logo"
          />
        </header>

        <main className="main-content">
          <div className="upload-container">
            <div className="submitted-success">
              <div className="success-icon-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <h1>Submitted for Printing!</h1>
              <p className="submitted-order">Order {info.orderNumber}</p>
              <p className="submitted-message">
                Your {info.currentUploads} photos have been submitted successfully. 
                The printing process has begun.
              </p>
              <div className="submitted-details">
                <div className="detail-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <span>Submitted on {new Date(info.submittedAt!).toLocaleDateString('en-US', { 
                    month: 'long', 
                    day: 'numeric', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}</span>
                </div>
              </div>
              
              {/* Show uploaded photos in read-only mode */}
              {uploadedImages.length > 0 && (
                <div className="uploaded-section readonly">
                  <div className="section-header">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <h3>Your Photos ({uploadedImages.length})</h3>
                  </div>
                  <div className="uploaded-grid">
                    {uploadedImages.map((img) => (
                      <div key={img.id} className={`${getImageClass(img.id)} readonly`}>
                        <img 
                          src={img.s3Url} 
                          alt={img.originalName}
                          onLoad={(e) => handleImageLoad(img.id, e)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <a href="https://photobookx.com" className="primary-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                Back to PhotoBookX
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="upload-page">
      <header className="header">
        <img 
          src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
          alt="PhotoBookX" 
          className="logo"
        />
      </header>

      <main className="main-content">
        <div className="upload-container">
          {/* Order Info */}
          <div className="order-info">
            <h1>Upload Photos</h1>
            <p className="order-number">Order {info.orderNumber}</p>
            <div className="stats-row">
              <div className="stat-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <span><strong>{actualRemaining}</strong> remaining</span>
              </div>
              <div className="stat-item uploaded">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span><strong>{actualUploaded}</strong> uploaded</span>
              </div>
            </div>
          </div>

          {/* Step 1: Options Selection */}
          {!optionsConfirmed ? (
            <div className="options-step">
              <div className="step-header">
                <div className="step-number">1</div>
                <div className="step-info">
                  <h2>Choose Print Settings</h2>
                  <p>These settings will apply to <strong>all photos</strong> you upload</p>
                </div>
              </div>

              {/* Photo Size Section */}
              <div className="option-section-block">
                <div className="option-group">
                  <label className="option-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <line x1="9" y1="3" x2="9" y2="21"/>
                    </svg>
                    Photo Size
                  </label>
                  <div className="toggle-group">
                    <button 
                      className={`toggle-btn ${photoSize === 'small' ? 'active' : ''}`}
                      onClick={() => setPhotoSize('small')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="5" y="5" width="14" height="14" rx="2"/>
                      </svg>
                      <span className="toggle-label">Small</span>
                      <span className="toggle-desc">3" × 4"</span>
                    </button>
                    <button 
                      className={`toggle-btn ${photoSize === 'large' ? 'active' : ''}`}
                      onClick={() => setPhotoSize('large')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                      </svg>
                      <span className="toggle-label">Large</span>
                      <span className="toggle-desc">4" × 6"</span>
                    </button>
                  </div>
                </div>
                
                <div className="info-banner recommendation">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4"/>
                    <path d="M12 8h.01"/>
                  </svg>
                  <span>Small photos (3"×4") are recommended for <strong>Small Photobooks</strong>. Large photos (4"×6") are ideal for <strong>Large Photobooks</strong>.</span>
                </div>
              </div>

              {/* Print Style Section */}
              <div className="option-section-block">
                <div className="option-group">
                  <label className="option-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    Print Style
                  </label>
                  <div className="toggle-group">
                    <button 
                      className={`toggle-btn ${photoType === 'normal' ? 'active' : ''}`}
                      onClick={() => setPhotoType('normal')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                      </svg>
                      <span className="toggle-label">Normal</span>
                      <span className="toggle-desc">Edge to edge</span>
                    </button>
                    <button 
                      className={`toggle-btn ${photoType === 'polaroid' ? 'active' : ''}`}
                      onClick={() => setPhotoType('polaroid')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="1" width="18" height="22" rx="2"/>
                        <rect x="5" y="3" width="14" height="12" rx="1"/>
                      </svg>
                      <span className="toggle-label">Polaroid</span>
                      <span className="toggle-desc">White border</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="info-banner">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <span>All photos will be printed with these settings. You cannot mix sizes or styles in the same order.</span>
              </div>

              <button className="confirm-options-btn" onClick={handleConfirmOptions}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Confirm & Continue to Upload
              </button>
            </div>
          ) : (
            <>
              {/* Confirmed Options Banner */}
              <div className="confirmed-options">
                <div className="confirmed-info">
                  <span className="confirmed-label">Print Settings:</span>
                  <span className="option-tag">{photoSize === 'large' ? 'Large (4"×6")' : 'Small (3"×4")'}</span>
                  <span className="option-tag">{photoType === 'normal' ? 'Normal' : 'Polaroid'}</span>
                </div>
                <button className="change-options-btn" onClick={handleChangeOptions}>
                  Change
                </button>
              </div>

              {/* Step 2: Upload */}
              <div className="upload-step">
                <div className="step-header">
                  <div className="step-number">2</div>
                  <div className="step-info">
                    <h2>Upload Your Photos</h2>
                    <p>Add up to {actualRemaining} more photos</p>
                  </div>
                </div>

                {/* Upload Zone */}
                {actualRemaining > 0 && (
                  <div 
                    className={`upload-zone ${isDragging ? 'dragging' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff"
                      multiple
                      onChange={handleFileSelect}
                      hidden
                    />
                    <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <p className="upload-text">Drop photos here or click to browse</p>
                    <p className="upload-hint">JPG, PNG up to 20MB each</p>
                  </div>
                )}

                {/* Selected Files Preview */}
                {selectedFiles.length > 0 && (
                  <div className="preview-section">
                    <div className="preview-header">
                      <span className="preview-count">{selectedFiles.length} photo{selectedFiles.length !== 1 ? 's' : ''} selected</span>
                      {pendingCount > 0 && (
                        <button className="upload-btn" onClick={handleUpload} disabled={isUploading}>
                          {isUploading ? (
                            <>
                              <div className="btn-loader"></div>
                              Uploading...
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                              </svg>
                              Upload {pendingCount} Photo{pendingCount !== 1 ? 's' : ''}
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <div className="preview-grid">
                      {selectedFiles.map((file, index) => (
                        <div 
                          key={index} 
                          className={`preview-card ${file.uploaded ? 'uploaded' : ''} ${file.uploading ? 'uploading' : ''} ${file.error ? 'error' : ''}`}
                        >
                          {!file.previewError ? (
                            <img 
                              src={file.preview} 
                              alt={file.file.name} 
                              onError={() => markPreviewError(file.preview)}
                            />
                          ) : (
                            <div className="image-fallback">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <line x1="9" y1="3" x2="9" y2="21"/>
                                <circle cx="14.5" cy="8.5" r="1.5"/>
                              </svg>
                              <p>Preview not available</p>
                              <span className="fallback-name">{file.file.name}</span>
                            </div>
                          )}
                          {file.uploading && (
                            <div className="preview-overlay">
                              <div className="preview-loader"></div>
                            </div>
                          )}
                          {file.uploaded && (
                            <div className="preview-overlay success">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            </div>
                          )}
                          {file.error && (
                            <div className="preview-overlay error">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </div>
                          )}
                          {!file.uploaded && !file.uploading && (
                            <button className="remove-btn" onClick={(e) => { e.stopPropagation(); removeFile(index); }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Uploaded Images Section */}
          {uploadedImages.length > 0 && (
            <div className="uploaded-section">
              <div className="section-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <h3>Uploaded Photos ({uploadedImages.length})</h3>
              </div>
              
              <div className="data-notice">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="16" x2="12" y2="12"/>
                  <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <span>Your photos will be permanently deleted from our servers after printing is complete.</span>
              </div>
              <div className="uploaded-grid">
                {uploadedImages.map((img) => (
                  <div key={img.id} className={`${getImageClass(img.id)} ${deletingImageId === img.id ? 'deleting' : ''}`}>
                    {imageLoadFailures[img.id] ? (
                      <div className="image-fallback">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <line x1="9" y1="3" x2="9" y2="21"/>
                          <circle cx="14.5" cy="8.5" r="1.5"/>
                        </svg>
                        <p>Preview not available</p>
                        <span className="fallback-name">{img.originalName}</span>
                      </div>
                    ) : (
                      <img 
                        src={img.s3Url} 
                        alt={img.originalName} 
                        onLoad={(e) => handleImageLoad(img.id, e)}
                        onError={() => handleImageError(img.id)}
                      />
                    )}
                    {deletingImageId === img.id ? (
                      <div className="delete-overlay">
                        <div className="delete-loader"></div>
                      </div>
                    ) : (
                      <>
                        <div className="uploaded-check">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        </div>
                        <button 
                          className="delete-btn" 
                          onClick={() => handleDeleteImage(img.id)}
                          title="Delete photo"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Send for Printing Section */}
          <div className="submit-section">
            {allPhotosUploaded ? (
              <>
                <div className="submit-ready">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <span>All {maxUploads} photos uploaded! Ready to print.</span>
                </div>
                <button 
                  className="submit-btn" 
                  onClick={handleSubmitForPrinting}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <div className="btn-loader"></div>
                      Submitting...
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 6 2 18 2 18 9"/>
                        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                        <rect x="6" y="14" width="12" height="8"/>
                      </svg>
                      Send for Printing
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="submit-pending">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>Upload {actualRemaining} more photo{actualRemaining !== 1 ? 's' : ''} to submit for printing</span>
                </div>
                <button className="submit-btn disabled" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 6 2 18 2 18 9"/>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                    <rect x="6" y="14" width="12" height="8"/>
                  </svg>
                  Send for Printing
                </button>
              </>
            )}
          </div>

          <p className="expires-text">
            Link expires {new Date(info.expiresAt!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </main>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
            </div>
            <h2>Ready to Print?</h2>
            <p className="modal-message">
              You're about to submit <strong>{actualUploaded} photos</strong> for printing.
            </p>
            <div className="modal-warning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div>
                <strong>This action cannot be undone.</strong>
                <span>Once submitted, you won't be able to add, remove, or modify any photos.</span>
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn cancel" onClick={() => setShowConfirmModal(false)}>
                Cancel
              </button>
              <button className="modal-btn confirm" onClick={confirmSubmitForPrinting}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Yes, Send for Printing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
