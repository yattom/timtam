import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  AudioStream,
} from '@aws-sdk/client-transcribe-streaming';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';
import { Readable } from 'stream';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const KINESIS_STREAM_NAME = process.env.KINESIS_STREAM_NAME || 'transcript-asr';
const LANGUAGE_CODE = 'ja-JP';
const SAMPLE_RATE = 48000; // Chime SDK default
const CHUNK_SIZE = 1024 * 8; // 8KB chunks for streaming

const s3 = new S3Client({ region: REGION });
const transcribe = new TranscribeStreamingClient({ region: REGION });
const kinesis = new KinesisClient({ region: REGION });

/**
 * S3 event handler: triggered when audio files are uploaded by Media Capture Pipeline
 * Processes audio file → Transcribe Streaming → Kinesis
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
 * Download audio from S3, stream to Transcribe, write transcripts to Kinesis
 */
async function processAudioFile(bucket: string, key: string): Promise<void> {
  // Step 1: Get audio file from S3
  const s3Resp = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (!s3Resp.Body) {
    throw new Error('S3 object body is empty');
  }

  // Step 2: Convert S3 body to Node.js Readable stream
  const audioStream = s3Resp.Body as Readable;

  // Step 3: Create async generator for Transcribe Streaming
  const audioGenerator = async function* () {
    const chunks: Buffer[] = [];

    for await (const chunk of audioStream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);

      // Yield audio chunks for streaming
      while (chunks.length > 0) {
        const data = chunks.shift()!;
        if (data.length > 0) {
          yield { AudioEvent: { AudioChunk: data } };
        }
      }
    }
  };

  // Step 4: Start streaming transcription
  const transcribeCommand = new StartStreamTranscriptionCommand({
    LanguageCode: LANGUAGE_CODE,
    MediaSampleRateHertz: SAMPLE_RATE,
    MediaEncoding: 'pcm', // Chime SDK uses PCM audio
    AudioStream: audioGenerator() as AsyncIterable<AudioStream>,
    EnablePartialResultsStabilization: true,
    PartialResultsStability: 'medium',
  });

  const transcribeResp = await transcribe.send(transcribeCommand);

  // Step 5: Process transcription results and write to Kinesis
  if (transcribeResp.TranscriptResultStream) {
    for await (const event of transcribeResp.TranscriptResultStream) {
      if (event.TranscriptEvent) {
        const results = event.TranscriptEvent.Transcript?.Results || [];

        for (const result of results) {
          if (result.Alternatives && result.Alternatives.length > 0) {
            const transcript = result.Alternatives[0].Transcript || '';
            const isPartial = !result.IsPartial;

            if (transcript) {
              // Write to Kinesis
              const kinesisData = {
                transcript,
                isPartial,
                timestamp: new Date().toISOString(),
                sourceFile: key,
              };

              await kinesis.send(
                new PutRecordCommand({
                  StreamName: KINESIS_STREAM_NAME,
                  Data: Buffer.from(JSON.stringify(kinesisData)),
                  PartitionKey: key, // Use S3 key as partition key
                })
              );

              console.log('[AudioConsumer] Transcript written to Kinesis', {
                transcript: transcript.substring(0, 100),
                isPartial,
                sourceFile: key,
              });
            }
          }
        }
      }
    }
  }

  console.log('[AudioConsumer] Audio file processing completed', { bucket, key });
}
