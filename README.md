# cdk-sns-digest: Create a digest version of an SNS topic

This AWS CDK Construct creates a digest version of an existing SNS topic. The digest infrastructure aggregates noficiations from an SNS topic over a period of time (using an intermediary SQS queue and a scheduled Lambda function) into .csv or .json format, stores it in a new S3 bucket, and sends notifications to the digest SNS topic with a presigned link to download the aggregate file.

## Motivation

I had a project where I created a small ETL process to parse Excel files upon upload to S3. Upon completion of the parsing, a notification was sent to an SNS topic with e-mail subscriptions. These uploads could either happen sporatically or as a bulk process. The bulk processes tended to overrun the e-mail endpoints with hundreds of notifications, and the original suggestion was to unsubscribe prior to the bulk submissions and resubscribe after. I created this digest process so that bulk notifications do not overrun e-mail endpoints.

## Installation

```
npm i @rogerchi/cdk-sns-digest
```

## Example Usage

### Use default aggregation Lambda function

Included in the package is a simple Python lambda function which aggregates the notifications using the pandas library. The latest pandas layer is retrieved from [KLayers](https://github.com/keithrozario/Klayers).

```typescript
import { createSnsDigest, SnsDigestFormat } from "@rogerchi/cdk-sns-digest";

// Within a stack
const snsDigest = createSnsDigest(this, "snsDigest", {
  snsTopic: Topic, // Existing SNS Topic
  format: SnsDigestFormat.CSV, // SnsDigestFormat.CSV or SnsDigestFormat.JSON
  schedule: Schedule.expression("rate(5 minutes)"), // Digest rate
});
```

### Supply your own Lambda function

Use your own lambda function to aggregate the notifications. Environment variables passed to the lambda function are:

- SQS_QUEUE_URL
- SQS_QUEUE_NAME
- SQS_QUEUE_ARN
- DIGEST_TOPIC_ARN
- DIGEST_TOPIC_NAME
- DIGEST_BUCKET_NAME
- DIGEST_BUCKET_ARN

```typescript
import { SnsDigest, SnsDigestFormat } from '@rogerchi/cdk-sns-digest';

// Within a stack
  const snsDigest = new SnsDigest(this, "snsDigest", {
    snsTopic: sns.Topic, // Required
    format: SnsDigestFormat.CSV, // Optional, defaults to SnsDigestFormat.CSV
    schedule: events.Schedule, // Optional, defaults to 5 minutes
    aggregatorLambda: lambda.Function; // Required
  });
```

## Limitations

This was created to handle "human-scale" notifications and tested with digests of around 1000 notifications over a five minute period.
