import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
} from '@aws-sdk/client-transcribe';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const KINESIS_STREAM_NAME = process.env.KINESIS_STREAM_NAME || 'transcript-asr';
const LANGUAGE_CODE = 'ja-JP';
const POLL_INTERVAL_MS = 1000; // Poll every 1 second
const MAX_POLL_ATTEMPTS = 60; // Max 60 seconds (5-second audio should complete quickly)

const s3 = new S3Client({ region: REGION });
const transcribe = new TranscribeClient({ region: REGION });
const kinesis = new KinesisClient({ region: REGION });

/**
 * S3 event handler: triggered when audio files are uploaded by Media Capture Pipeline
 * Processes audio file → Transcribe Batch Job → Kinesis
 */
export const handler = async (event: S3Event): Promise<void> => {
  console.log('[AudioConsumer] Processing S3 event', {
    records: event.Records.length,
  });

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    console.log('[AudioConsumer] Processing audio file', { bucket, key });

    try {
      await processAudioFile(bucket, key);
    } catch (err: any) {
      console.error('[AudioConsumer] Failed to process audio file', {
        bucket,
        key,
        error: err?.message || err,
      });
      throw err; // Rethrow to trigger Lambda retry
    }
  }
};

/**
 * Start batch transcription job, poll for completion, write results to Kinesis
 */
async function processAudioFile(bucket: string, key: string): Promise<void> {
  // Generate unique job name
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const jobName = `transcribe-${timestamp}-${random}`;

  // Step 1: Start batch transcription job
  const mediaFileUri = `s3://${bucket}/${key}`;

  console.log('[AudioConsumer] Starting transcription job', {
    jobName,
    mediaFileUri,
  });

  await transcribe.send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: mediaFileUri },
      MediaFormat: 'mp4',
      LanguageCode: LANGUAGE_CODE,
      // Output will be written to default location in S3
    })
  );

  // Step 2: Poll for job completion
  let attempts = 0;
  let jobStatus: TranscriptionJobStatus | undefined;
  let transcriptFileUri: string | undefined;

  while (attempts < MAX_POLL_ATTEMPTS) {
    await sleep(POLL_INTERVAL_MS);
    attempts++;

    const jobResp = await transcribe.send(
      new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      })
    );

    jobStatus = jobResp.TranscriptionJob?.TranscriptionJobStatus;

    console.log('[AudioConsumer] Job status check', {
      jobName,
      status: jobStatus,
      attempt: attempts,
    });

    if (jobStatus === TranscriptionJobStatus.COMPLETED) {
      transcriptFileUri = jobResp.TranscriptionJob?.Transcript?.TranscriptFileUri;
      break;
    } else if (jobStatus === TranscriptionJobStatus.FAILED) {
      const failureReason = jobResp.TranscriptionJob?.FailureReason;
      throw new Error(`Transcription job failed: ${failureReason}`);
    }
  }

  if (jobStatus !== TranscriptionJobStatus.COMPLETED || !transcriptFileUri) {
    throw new Error(`Transcription job timed out after ${MAX_POLL_ATTEMPTS} attempts`);
  }

  // Step 3: Fetch and parse transcription results
  console.log('[AudioConsumer] Fetching transcript results', {
    transcriptFileUri,
  });

  const transcriptResp = await fetch(transcriptFileUri);
  const transcriptData = await transcriptResp.json();

  // Step 4: Extract meetingId from S3 key
  // Key format: {meetingId}/audio/{timestamp}.mp4
  const meetingId = key.split('/')[0];

  // Step 5: Write transcript to Kinesis in Orchestrator-compatible format
  // Transcribe output format: { results: { transcripts: [{ transcript: "..." }], items: [...] } }
  const fullTranscript = transcriptData.results?.transcripts?.[0]?.transcript || '';

  if (fullTranscript) {
    const kinesisData = {
      meetingId,
      text: fullTranscript,
      isFinal: true, // Batch transcription is always final
      timestamp: Date.now(), // Epoch milliseconds
      speakerId: undefined, // TODO: Add speaker identification if needed
      sequenceNumber: undefined,
    };

    await kinesis.send(
      new PutRecordCommand({
        StreamName: KINESIS_STREAM_NAME,
        Data: Buffer.from(JSON.stringify(kinesisData)),
        PartitionKey: meetingId, // Use meetingId for better partitioning
      })
    );

    console.log('[AudioConsumer] Transcript written to Kinesis', {
      meetingId,
      transcript: fullTranscript.substring(0, 100),
      sourceFile: key,
    });
  } else {
    console.log('[AudioConsumer] No transcript found in results', {
      transcriptData: JSON.stringify(transcriptData).substring(0, 200),
    });
  }

  console.log('[AudioConsumer] Audio file processing completed', { bucket, key });
}

/**
 * Sleep utility for polling
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
