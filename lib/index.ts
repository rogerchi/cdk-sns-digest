import * as path from "path";
import { Construct, Duration, RemovalPolicy } from "@aws-cdk/core";
import * as sns from "@aws-cdk/aws-sns";
import * as lambda from "@aws-cdk/aws-lambda";
import * as sqs from "@aws-cdk/aws-sqs";
import * as subscriptions from "@aws-cdk/aws-sns-subscriptions";
import * as s3 from "@aws-cdk/aws-s3";
import * as Papa from "papaparse";
import { Rule, Schedule } from "@aws-cdk/aws-events";
import { LambdaFunction } from "@aws-cdk/aws-events-targets";
import fetch from "node-fetch";

export enum SnsDigestFormat {
  JSON = "json",
  CSV = "csv",
  HTML = "html",
}

interface createSnsDigestProps {
  readonly snsTopic: sns.Topic;
  readonly format?: SnsDigestFormat;
  readonly schedule?: Schedule;
  readonly aggregatorLambda?: lambda.Function;
}

export interface SnsDigestProps {
  readonly snsTopic: sns.Topic;
  readonly format?: SnsDigestFormat;
  readonly schedule?: Schedule;
  readonly aggregatorLambda: lambda.Function;
}

export class SnsDigest extends Construct {
  public readonly snsTopic: sns.Topic;
  public readonly snsDigestTopic: sns.Topic;
  public readonly sqsQueue: sqs.Queue;
  public readonly lambdaFunction: lambda.Function;
  public readonly eventRule: Rule;
  public readonly digestBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SnsDigestProps) {
    super(scope, id);

    const format = props.format ?? SnsDigestFormat.CSV;
    const schedule = props.schedule ?? Schedule.expression("rate(5 minutes)");

    // The code that defines your stack goes here
    this.snsTopic = props.snsTopic;

    this.sqsQueue = new sqs.Queue(this, "sqsQueue", {
      receiveMessageWaitTime: Duration.seconds(1),
    });

    this.snsTopic.addSubscription(
      new subscriptions.SqsSubscription(this.sqsQueue)
    );

    this.snsDigestTopic = new sns.Topic(this, "snsDigestTopic", {
      topicName: `${this.snsTopic.topicName}-digest`,
    });

    this.digestBucket = new s3.Bucket(this, "digestBucket", {
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.lambdaFunction = props.aggregatorLambda;

    this.lambdaFunction.addEnvironment("SQS_QUEUE_URL", this.sqsQueue.queueUrl);
    this.lambdaFunction.addEnvironment(
      "SQS_QUEUE_NAME",
      this.sqsQueue.queueName
    );
    this.lambdaFunction.addEnvironment("SQS_QUEUE_ARN", this.sqsQueue.queueArn);
    this.lambdaFunction.addEnvironment(
      "DIGEST_TOPIC_ARN",
      this.snsDigestTopic.topicArn
    );
    this.lambdaFunction.addEnvironment(
      "DIGEST_TOPIC_NAME",
      this.snsDigestTopic.topicName
    );
    this.lambdaFunction.addEnvironment(
      "DIGEST_BUCKET_NAME",
      this.digestBucket.bucketName
    );
    this.lambdaFunction.addEnvironment(
      "DIGEST_BUCKET_ARN",
      this.digestBucket.bucketArn
    );
    this.lambdaFunction.addEnvironment("OUTPUT_FORMAT", format);

    this.digestBucket.grantReadWrite(this.lambdaFunction);
    this.sqsQueue.grantConsumeMessages(this.lambdaFunction);
    this.snsDigestTopic.grantPublish(this.lambdaFunction);

    this.eventRule = new Rule(this, "Rule", {
      description: "Rule to trigger SNS digest processing",
      schedule,
      targets: [new LambdaFunction(this.lambdaFunction)],
    });
  }
}

async function getPandasLayerArn(): Promise<string> {
  const region = process.env.CDK_DEFAULT_REGION;
  const url = `https://raw.githubusercontent.com/keithrozario/Klayers/master/deployments/python3.8/arns/${region}.csv`;
  const csvStream = await fetch(url).then((response) => response.body);
  const parseStream = (stream: NodeJS.ReadableStream): Promise<string> => {
    return new Promise((resolve) => {
      Papa.parse(stream, {
        header: true,
        step: (results: any, parser) => {
          if (
            results.data["Package"] === "pandas" &&
            results.data["Status"] === "latest"
          ) {
            resolve(results.data["Arn"]);
            parser.abort();
          }
        },
      });
    });
  };
  let parsedData = await parseStream(csvStream);
  return parsedData;
}

export async function createSnsDigest(
  scope: Construct,
  id: string,
  props: createSnsDigestProps
) {
  const arn = await getPandasLayerArn();
  const lambdaLayer = lambda.LayerVersion.fromLayerVersionArn(
    scope,
    `${id}-LambdaLayer`,
    arn
  );
  const aggregatorLambda =
    props.aggregatorLambda ??
    new lambda.Function(scope, "lambdaFunction", {
      code: lambda.Code.fromAsset(path.join(__dirname, "../python/sns-digest")),
      handler: "index.lambda_handler",
      runtime: lambda.Runtime.PYTHON_3_8,
      memorySize: 512,
      timeout: Duration.seconds(600),
      layers: [lambdaLayer],
    });
  const snsTopic = props.snsTopic;
  const format = props.format ?? SnsDigestFormat.CSV;
  const schedule = props.schedule ?? Schedule.expression("rate(5 minutes)");
  return new SnsDigest(scope, "SnsDigest", {
    snsTopic,
    format,
    schedule,
    aggregatorLambda,
  });
}
