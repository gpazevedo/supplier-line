import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const sns = new SNSClient({});

/** Emails the owner through the alerts topic named by `TOPIC_ARN`. */
export async function alert(subject: string, message: string): Promise<void> {
  await sns.send(
    new PublishCommand({
      TopicArn: process.env.TOPIC_ARN,
      Subject: `supplier-line: ${subject}`,
      Message: message,
    })
  );
}
