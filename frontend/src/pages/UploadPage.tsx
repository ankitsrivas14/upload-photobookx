import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { UploadInfo } from '../services/api';
import { Alert, Badge, Button, Card, Dialog, Dropzone, EmptyState, Icon, OptionCard, PhotoTile, Stepper } from '../components/ui/pbx';
import { cx } from '../components/ui/format';
import styles from './UploadPage.module.css';

type PhotoSize = 'large' | 'small';
type PhotoType = 'normal' | 'polaroid';
type Orientation = 'landscape' | 'portrait' | 'square';

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
  orientation?: Orientation;
}

const LOGO = 'https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052';
const STORE = 'https://photobookx.com';
const STEPS = [{ label: 'Print settings' }, { label: 'Photos' }, { label: 'Send for printing' }];
const SIZE_LABEL: Record<PhotoSize, string> = { small: 'Small · 3″ × 4″', large: 'Large · 4″ × 6″' };
const ACCEPT = 'image/*,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const longDate = (iso: string, withTime = false) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) });

// Prints are 3×4 (small) or 4×6 (large); a landscape photo prints on its side.
function printRatio(size: PhotoSize, orientation?: Orientation): string {
  const [w, h] = size === 'large' ? [2, 3] : [3, 4];
  return orientation === 'landscape' ? `${h} / ${w}` : `${w} / ${h}`;
}

/** The customer page around every state: the PhotoBookX logo, then one centred column. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.brand}>
        <a href={STORE}>
          <img src={LOGO} alt="PhotoBookX" className={styles.logo} />
        </a>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

const storeLink = (label: string, variant: 'primary' | 'secondary') => (
  <a href={STORE} className={cx('pbx-btn', 'pbx-btn--' + variant, 'pbx-btn--lg')}>
    {label}
  </a>
);

/** The customer's magic-link page: choose print settings, upload the order's photos, send them for printing. */
export function UploadPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Selection state - locked once confirmed
  const [photoSize, setPhotoSize] = useState<PhotoSize>('small');
  const [photoType, setPhotoType] = useState<PhotoType>('normal');
  const [optionsConfirmed, setOptionsConfirmed] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Uploaded images
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [imageOrientations, setImageOrientations] = useState<Record<string, Orientation>>({});
  const [imageLoadFailures, setImageLoadFailures] = useState<Record<string, boolean>>({});

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Detect image orientation when image loads (keyed by image id, or by preview URL before upload)
  const handleImageLoad = (imageId: string, event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const ratio = img.naturalWidth / img.naturalHeight;
    let orientation: Orientation = 'square';

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
    } catch {
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
        toast.error(result.error || 'Failed to save settings');
      }
    } catch {
      toast.error('Failed to save settings');
    }
  };

  // Changing settings clears photos chosen but not uploaded yet, so ask first when there are any.
  const handleChangeOptions = () => {
    if (selectedFiles.length > 0) {
      setConfirmChange(true);
      return;
    }
    setOptionsConfirmed(false);
  };

  const changeOptions = () => {
    selectedFiles.forEach(f => URL.revokeObjectURL(f.preview));
    setSelectedFiles([]);
    setConfirmChange(false);
    setOptionsConfirmed(false);
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

    if (imageFiles.length < files.length) {
      toast.error('Some files were not photos and were skipped');
    }
    if (filesToAdd.length < imageFiles.length) {
      toast.error(`Only ${plural(Math.max(0, remainingSlots), 'more photo')} fit in this order`);
    }

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
      } catch {
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

  const confirmDeleteImage = async () => {
    const imageId = pendingDelete;
    setPendingDelete(null);
    if (!token || !imageId) return;

    setDeletingImageId(imageId);

    try {
      const result = await api.deleteImage(token, imageId);

      if (result.success) {
        setImageLoadFailures(prev => {
          const { [imageId]: _removed, ...rest } = prev;
          void _removed;
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
        toast.error(result.error || 'Failed to delete image');
      }
    } catch {
      toast.error('Failed to delete image');
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
        // Scroll to top to show the submitted state
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      } else {
        toast.error(result.error || 'Failed to submit for printing');
      }
    } catch {
      toast.error('Failed to submit for printing');
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

  const uploadedTile = (img: UploadedImage, removable: boolean) => (
    <PhotoTile
      key={img.id}
      src={imageLoadFailures[img.id] ? undefined : img.s3Url}
      alt={img.originalName}
      printStyle={img.photoType || photoType}
      ratio={printRatio(img.photoSize || photoSize, imageOrientations[img.id])}
      onImageLoad={(e) => handleImageLoad(img.id, e)}
      onImageError={() => handleImageError(img.id)}
      onRemove={removable && deletingImageId !== img.id ? () => setPendingDelete(img.id) : undefined}
      label={imageLoadFailures[img.id] ? 'Preview not available' : undefined}
      className={deletingImageId === img.id ? styles.deleting : undefined}
    />
  );

  if (isLoading) {
    return (
      <Frame>
        <div className={styles.center}>
          <span className="pbx-spinner" aria-hidden="true" />
          <span>Loading your order…</span>
        </div>
      </Frame>
    );
  }

  if (error || !info) {
    return (
      <Frame>
        <EmptyState
          icon="triangle-alert"
          title="This link can't be used"
          description={error || 'This upload link is invalid or has expired.'}
          action={storeLink('Visit PhotoBookX', 'primary')}
        />
      </Frame>
    );
  }

  // If images have been deleted after printing, show completion message
  if (info.imagesDeleted) {
    return (
      <Frame>
        <EmptyState
          icon="circle-check"
          title="Order complete"
          description={`Order ${info.orderNumber} has been printed. As promised, your photos have been deleted from our servers. Thank you for choosing PhotoBookX.`}
          action={storeLink('Back to PhotoBookX', 'primary')}
        />
      </Frame>
    );
  }

  // If already submitted, show success state
  if (isSubmitted) {
    const submittedCount = uploadedImages.length > 0
      ? uploadedImages.length
      : info.currentUploads || actualUploaded || maxUploads;

    return (
      <Frame>
        <section className={styles.done}>
          <span className={styles.doneIcon}><Icon name="circle-check" size={28} /></span>
          <h1 className={styles.title}>Sent for printing</h1>
          <p className={styles.order}>Order {info.orderNumber}</p>
          <p className={styles.note}>
            Your {plural(submittedCount, 'photo')} {submittedCount === 1 ? 'was' : 'were'} sent
            {info.submittedAt ? ` on ${longDate(info.submittedAt, true)}` : ''}. Printing has started.
          </p>
        </section>

        {uploadedImages.length > 0 && (
          <Card title="Your photos" eyebrow={String(uploadedImages.length)}>
            <div className={styles.grid}>{uploadedImages.map((img) => uploadedTile(img, false))}</div>
          </Card>
        )}

        <div className={styles.back}>{storeLink('Back to PhotoBookX', 'secondary')}</div>
      </Frame>
    );
  }

  const step = !optionsConfirmed ? 0 : allPhotosUploaded ? 2 : 1;

  return (
    <Frame>
      <section className={styles.intro}>
        <div>
          <h1 className={styles.title}>Upload your photos</h1>
          <p className={styles.order}>Order {info.orderNumber}</p>
        </div>
        <Stepper steps={STEPS} current={step} className={styles.steps} />
        <p className={styles.counts}>
          <span><strong>{actualUploaded}</strong> of {maxUploads} uploaded</span>
          <span><strong>{actualRemaining}</strong> to go</span>
        </p>
      </section>

      {/* Step 1: Options Selection */}
      {!optionsConfirmed ? (
        <Card title="Choose your print settings" description="They apply to every photo in this order.">
          <fieldset className={styles.choices}>
            <legend className={styles.legend}>Photo size</legend>
            <div className={styles.choiceRow}>
              <OptionCard
                name="photo-size"
                value="small"
                checked={photoSize === 'small'}
                onChange={() => setPhotoSize('small')}
                title="Small"
                description={'3″ × 4″ · for Small photobooks'}
                media={<span className={cx(styles.print, styles.small)} />}
              />
              <OptionCard
                name="photo-size"
                value="large"
                checked={photoSize === 'large'}
                onChange={() => setPhotoSize('large')}
                title="Large"
                description={'4″ × 6″ · for Large photobooks'}
                media={<span className={cx(styles.print, styles.large)} />}
              />
            </div>
          </fieldset>

          <fieldset className={styles.choices}>
            <legend className={styles.legend}>Print style</legend>
            <div className={styles.choiceRow}>
              <OptionCard
                name="photo-type"
                value="normal"
                checked={photoType === 'normal'}
                onChange={() => setPhotoType('normal')}
                title="Normal"
                description="Edge to edge"
                media={<span className={cx(styles.print, styles.small)} />}
              />
              <OptionCard
                name="photo-type"
                value="polaroid"
                checked={photoType === 'polaroid'}
                onChange={() => setPhotoType('polaroid')}
                title="Polaroid"
                description="White border"
                media={<span className={cx(styles.print, styles.small, styles.polaroid)} />}
              />
            </div>
          </fieldset>

          <Alert tone="info">All photos print with these settings; one order can't mix sizes or styles.</Alert>

          <div className={styles.actions}>
            <Button variant="primary" size="lg" fullWidth icon="check" onClick={handleConfirmOptions}>
              Confirm and continue
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* Confirmed Options */}
          <div className={styles.settings}>
            <span className={styles.settingsLabel}>Print settings</span>
            <Badge dot={false}>{SIZE_LABEL[photoSize]}</Badge>
            <Badge dot={false}>{photoType === 'normal' ? 'Normal' : 'Polaroid'}</Badge>
            <Button className={styles.settingsChange} variant="ghost" size="sm" onClick={handleChangeOptions} disabled={isUploading}>
              Change
            </Button>
          </div>

          {/* Step 2: Upload */}
          <Card title="Add your photos" description={actualRemaining > 0 ? `Add up to ${plural(actualRemaining, 'more photo')}.` : 'Every photo for this order is uploaded.'}>
            {actualRemaining > 0 && (
              <Dropzone
                size="lg"
                accept={ACCEPT}
                multiple
                icon="image"
                title="Drop your photos here"
                hint="JPG, PNG or HEIC, up to 20 MB each"
                buttonLabel="Choose photos"
                disabled={isUploading}
                onFiles={addFiles}
              />
            )}

            {selectedFiles.length > 0 && (
              <>
                <div className={styles.selectedBar}>
                  <span className={styles.note}>{plural(selectedFiles.length, 'photo')} chosen</span>
                  {pendingCount > 0 && (
                    <Button variant="primary" size="lg" icon="upload" loading={isUploading} onClick={handleUpload}>
                      {isUploading ? 'Uploading…' : `Upload ${plural(pendingCount, 'photo')}`}
                    </Button>
                  )}
                </div>
                <div className={styles.grid}>
                  {selectedFiles.map((file, index) => (
                    <PhotoTile
                      key={file.preview}
                      src={file.previewError ? undefined : file.preview}
                      alt={file.file.name}
                      status={file.uploading ? 'uploading' : file.uploaded ? 'uploaded' : file.error ? 'error' : 'ready'}
                      printStyle={photoType}
                      ratio={printRatio(photoSize, imageOrientations[file.preview])}
                      onImageLoad={(e) => handleImageLoad(file.preview, e)}
                      onImageError={() => markPreviewError(file.preview)}
                      onRemove={!file.uploaded && !file.uploading ? () => removeFile(index) : undefined}
                      label={file.error ? <span className={styles.fileError}>{file.error}</span> : file.previewError ? 'Preview not available' : file.file.name}
                    />
                  ))}
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {/* Uploaded Images Section */}
      {uploadedImages.length > 0 && (
        <Card
          title="Uploaded photos"
          eyebrow={String(uploadedImages.length)}
          description="Your photos are deleted from our servers once printing is complete."
        >
          <div className={styles.grid}>{uploadedImages.map((img) => uploadedTile(img, true))}</div>
        </Card>
      )}

      {/* Send for Printing Section */}
      <section className={styles.submit}>
        {allPhotosUploaded ? (
          <Alert tone="positive" title={`All ${maxUploads} photos are uploaded`}>
            Check them above, then send them for printing.
          </Alert>
        ) : (
          <p className={styles.note}>Upload {plural(actualRemaining, 'more photo')} to send your order for printing.</p>
        )}
        <Button
          variant={allPhotosUploaded ? 'primary' : 'secondary'}
          size="lg"
          fullWidth
          icon="printer"
          disabled={!allPhotosUploaded}
          loading={isSubmitting}
          onClick={handleSubmitForPrinting}
        >
          {isSubmitting ? 'Sending…' : 'Send for printing'}
        </Button>
      </section>

      {info.expiresAt && <p className={styles.expires}>This link expires on {longDate(info.expiresAt)}</p>}

      <Dialog
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="Send your photos for printing?"
        description={`You're sending ${plural(actualUploaded, 'photo')}.`}
        icon="printer"
        tone="caution"
        footer={
          <>
            <Button onClick={() => setShowConfirmModal(false)}>Cancel</Button>
            <Button variant="primary" icon="check" onClick={confirmSubmitForPrinting}>Yes, send for printing</Button>
          </>
        }
      >
        <Alert tone="caution" title="This can't be undone">
          Once sent, you can't add, remove or change any photos.
        </Alert>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this photo?"
        description="It is removed from your order and from our servers."
        icon="trash-2"
        tone="negative"
        size="sm"
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDeleteImage}>Delete photo</Button>
          </>
        }
      />

      <Dialog
        open={confirmChange}
        onClose={() => setConfirmChange(false)}
        title="Change your print settings?"
        description={`The ${plural(selectedFiles.length, 'photo')} you chose but have not uploaded yet will be cleared.`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={changeOptions}>Change settings</Button>
          </>
        }
      />
    </Frame>
  );
}
