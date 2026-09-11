import { S3Client } from '@aws-sdk/client-s3';
import config from '../config';

/**
 * Single S3 client for the whole backend.
 *
 * Uses explicit access keys from config (Secret Manager / .env). The previous EC2
 * instance-metadata (`fromInstanceMetadata`) credential path does not exist on Cloud
 * Functions / Cloud Run, so it has been removed — keys are now the only source.
 */
let client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!client) {
    if (!config.aws.accessKeyId || !config.aws.secretAccessKey) {
      throw new Error('AWS S3 credentials missing — set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
    }
    client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
      forcePathStyle: false,
    });
  }
  return client;
}
