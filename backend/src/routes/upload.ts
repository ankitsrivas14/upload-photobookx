import { Router, Request, Response } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import magicLinkService from '../services/magicLinkService';
import { UploadedImage } from '../models';
import type { PhotoSize, PhotoType } from '../models/UploadedImage';
import config from '../config';

const router = Router();

// Configure multer for memory storage (we'll stream to S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max
  },
  fileFilter: (_req, file, cb) => {
    // Only allow images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Configure S3 client
const getS3Client = () => {
  if (!config.aws.accessKeyId || !config.aws.secretAccessKey || !config.aws.s3Bucket) {
    console.warn('AWS S3 not configured properly. Check AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET env vars.');
  }
  
  return new S3Client({
    region: config.aws.region,
    credentials: {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    },
    // Use path-style URLs for better compatibility
    forcePathStyle: false,
  });
};

const s3Client = getS3Client();

/**
 * GET /api/upload/:token
 * Validate magic link and get upload info (public - no auth required)
 */
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    const magicLink = result.magicLink;

    res.json({
      success: true,
      orderNumber: magicLink.orderNumber,
      customerName: magicLink.customerName,
      maxUploads: magicLink.maxUploads,
      currentUploads: magicLink.currentUploads,
      remainingUploads: magicLink.maxUploads - magicLink.currentUploads,
      expiresAt: magicLink.expiresAt,
      submittedForPrinting: magicLink.submittedForPrinting || false,
      submittedAt: magicLink.submittedAt,
    });
  } catch (error) {
    console.error('Error validating upload link:', error);
    res.status(500).json({ success: false, error: 'Failed to validate link' });
  }
});

/**
 * POST /api/upload/:token/upload
 * Upload a single image (public - no auth required, just valid magic link)
 */
router.post('/:token/upload', upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    const magicLink = result.magicLink;

    // Check if we have remaining uploads
    if (magicLink.currentUploads >= magicLink.maxUploads) {
      res.status(400).json({ success: false, error: 'Upload limit reached' });
      return;
    }

    // Check if file was uploaded
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    // Get size and type from request body
    const photoSize = req.body.size as PhotoSize;
    const photoType = req.body.type as PhotoType;

    if (!photoSize || !['large', 'small'].includes(photoSize)) {
      res.status(400).json({ success: false, error: 'Invalid photo size' });
      return;
    }

    if (!photoType || !['normal', 'polaroid'].includes(photoType)) {
      res.status(400).json({ success: false, error: 'Invalid photo type' });
      return;
    }

    // Generate unique filename
    const fileExtension = req.file.originalname.split('.').pop() || 'jpg';
    const fileName = `${uuidv4()}.${fileExtension}`;
    const orderFolder = magicLink.orderNumber.replace(/[^a-zA-Z0-9]/g, '_');
    const s3Key = `uploads/${orderFolder}/${photoSize}/${photoType}/${fileName}`;

    // Upload to S3
    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        Metadata: {
          orderNumber: magicLink.orderNumber,
          originalName: req.file.originalname,
          photoSize,
          photoType,
        },
      }));
    } catch (s3Error: unknown) {
      console.error('S3 Upload Error:', s3Error);
      const errorMessage = s3Error instanceof Error ? s3Error.message : 'Unknown S3 error';
      
      // Check for region mismatch
      if (errorMessage.includes('PermanentRedirect') || errorMessage.includes('specified endpoint')) {
        res.status(500).json({ 
          success: false, 
          error: 'S3 bucket region mismatch. Check AWS_REGION configuration.' 
        });
        return;
      }
      
      res.status(500).json({ success: false, error: 'Failed to upload to storage' });
      return;
    }

    const s3Url = `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${s3Key}`;

    // Save to database
    const uploadedImage = new UploadedImage({
      magicLinkId: magicLink._id,
      orderNumber: magicLink.orderNumber,
      fileName,
      originalName: req.file.originalname,
      s3Key,
      s3Url,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      photoSize,
      photoType,
    });

    await uploadedImage.save();

    // Increment upload count
    await magicLinkService.incrementUploadCount(token);

    res.json({
      success: true,
      image: {
        id: uploadedImage._id,
        fileName,
        s3Url,
        photoSize,
        photoType,
      },
    });
  } catch (error) {
    console.error('Error handling upload:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

/**
 * GET /api/upload/:token/images
 * Get list of uploaded images for this magic link
 */
router.get('/:token/images', async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    const images = await UploadedImage.find({ magicLinkId: result.magicLink._id })
      .sort({ uploadedAt: -1 });

    res.json({
      success: true,
      images: images.map(img => ({
        id: img._id,
        fileName: img.fileName,
        originalName: img.originalName,
        s3Url: img.s3Url,
        photoSize: img.photoSize,
        photoType: img.photoType,
        uploadedAt: img.uploadedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching images:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch images' });
  }
});

/**
 * GET /api/upload/:token/images/:imageId/proxy
 * Proxy image from S3 to avoid CORS issues (for image editor)
 */
router.get('/:token/images/:imageId/proxy', async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const imageId = req.params.imageId as string;
    
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    // Find the image
    const image = await UploadedImage.findOne({
      _id: imageId,
      magicLinkId: result.magicLink._id,
    });

    if (!image) {
      res.status(404).json({ success: false, error: 'Image not found' });
      return;
    }

    // Fetch from S3
    const s3Response = await s3Client.send(new GetObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: image.s3Key,
    }));

    if (!s3Response.Body) {
      res.status(404).json({ success: false, error: 'Image not found in storage' });
      return;
    }

    // Set headers
    res.setHeader('Content-Type', image.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Stream the response
    const stream = s3Response.Body as NodeJS.ReadableStream;
    stream.pipe(res);
  } catch (error) {
    console.error('Error proxying image:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch image' });
  }
});

/**
 * DELETE /api/upload/:token/images/:imageId
 * Delete an uploaded image
 */
router.delete('/:token/images/:imageId', async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const imageId = req.params.imageId as string;
    
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    // Find the image
    const image = await UploadedImage.findOne({
      _id: imageId,
      magicLinkId: result.magicLink._id,
    });

    if (!image) {
      res.status(404).json({ success: false, error: 'Image not found' });
      return;
    }

    // Delete from S3
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: image.s3Key,
      }));
    } catch (s3Error) {
      console.warn('Failed to delete image from S3:', s3Error);
      // Continue anyway - we'll still remove from database
    }

    // Delete from database
    await UploadedImage.deleteOne({ _id: imageId });

    // Decrement upload count
    await magicLinkService.decrementUploadCount(token);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ success: false, error: 'Failed to delete image' });
  }
});

/**
 * PUT /api/upload/:token/images/:imageId
 * Update an existing image (replace with edited version)
 */
router.put('/:token/images/:imageId', upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const imageId = req.params.imageId as string;
    
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    // Check if file was uploaded
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    // Find the existing image
    const existingImage = await UploadedImage.findOne({
      _id: imageId,
      magicLinkId: result.magicLink._id,
    });

    if (!existingImage) {
      res.status(404).json({ success: false, error: 'Image not found' });
      return;
    }

    // Delete old image from S3
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: existingImage.s3Key,
      }));
    } catch (deleteError) {
      console.warn('Failed to delete old image from S3:', deleteError);
      // Continue anyway - old image will be orphaned but new one will still be uploaded
    }

    // Generate new filename
    const fileName = `${uuidv4()}.jpg`;
    const orderFolder = result.magicLink.orderNumber.replace(/[^a-zA-Z0-9]/g, '_');
    const s3Key = `uploads/${orderFolder}/${existingImage.photoSize}/${existingImage.photoType}/${fileName}`;

    // Upload new image to S3
    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: config.aws.s3Bucket,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: 'image/jpeg',
        Metadata: {
          orderNumber: result.magicLink.orderNumber,
          originalName: existingImage.originalName,
          photoSize: existingImage.photoSize,
          photoType: existingImage.photoType,
          editedAt: new Date().toISOString(),
        },
      }));
    } catch (s3Error) {
      console.error('S3 Upload Error:', s3Error);
      res.status(500).json({ success: false, error: 'Failed to upload to storage' });
      return;
    }

    const s3Url = `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${s3Key}`;

    // Update database record
    existingImage.fileName = fileName;
    existingImage.s3Key = s3Key;
    existingImage.s3Url = s3Url;
    existingImage.fileSize = req.file.size;
    existingImage.mimeType = 'image/jpeg';
    await existingImage.save();

    res.json({
      success: true,
      image: {
        id: existingImage._id,
        fileName,
        s3Url,
        photoSize: existingImage.photoSize,
        photoType: existingImage.photoType,
      },
    });
  } catch (error) {
    console.error('Error updating image:', error);
    res.status(500).json({ success: false, error: 'Failed to update image' });
  }
});

/**
 * POST /api/upload/:token/submit
 * Submit for printing - locks the upload and marks it as submitted
 */
router.post('/:token/submit', async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    const magicLink = result.magicLink;

    // Check if already submitted
    if (magicLink.submittedForPrinting) {
      res.status(400).json({ success: false, error: 'Already submitted for printing' });
      return;
    }

    // Check if all photos are uploaded
    if (magicLink.currentUploads < magicLink.maxUploads) {
      res.status(400).json({ 
        success: false, 
        error: `Please upload all ${magicLink.maxUploads} photos before submitting` 
      });
      return;
    }

    // Mark as submitted
    await magicLinkService.submitForPrinting(token);

    res.json({
      success: true,
      message: 'Successfully submitted for printing',
    });
  } catch (error) {
    console.error('Error submitting for printing:', error);
    res.status(500).json({ success: false, error: 'Failed to submit for printing' });
  }
});

export default router;
