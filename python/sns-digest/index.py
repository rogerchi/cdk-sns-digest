import boto3
import os
import pandas as pd
import csv
import json
import uuid
import calendar
import time

sns = boto3.client('sns')
sqs = boto3.client('sqs')
s3 = boto3.client('s3')
queue = os.environ['SQS_QUEUE_URL']
digest_topic = os.environ['DIGEST_TOPIC_ARN']
digest_bucket = os.environ['DIGEST_BUCKET_NAME']
output_format = os.environ['OUTPUT_FORMAT']


def publish_to_sns(presign):
    sns.publish(TopicArn=digest_topic,
                Message="{}".format(presign),
                Subject="Digest summary")


def lambda_handler(event, context):
    df = pd.DataFrame(columns=['MessageId', 'Subject', 'Message', 'Timestamp'])
    messages = sqs.receive_message(QueueUrl=queue,
                                   AttributeNames=['All'],
                                   MaxNumberOfMessages=10)
    while 'Messages' in messages:
        messages = messages['Messages']
        for message in messages:
            body = json.loads(message['Body'])
            row = {
                'MessageId': body['MessageId'],
                'Subject': body['Subject'],
                'Message': body['Message'],
                'Timestamp': body['Timestamp']
            }
            df = df.append(row, ignore_index=True)
            sqs.delete_message(QueueUrl=queue,
                               ReceiptHandle=message['ReceiptHandle'])
        messages = sqs.receive_message(QueueUrl=queue,
                                       AttributeNames=['All'],
                                       MaxNumberOfMessages=10)

    df = df.drop_duplicates(subset='MessageId')
    if len(df.index) == 1:
        sns.publish(TopicArn=digest_topic,
                    Message="{}".format(df.at[0, 'Message']),
                    Subject="{}".format(df.at[0, 'Subject']))
    elif len(df.index) > 1:
        filename = uuid.uuid4()
        if output_format == 'json':
            df.to_json("/tmp/{}.json".format(filename),
                       orient='records',
                       lines=True)
            try:
                s3.upload_file("/tmp/{}.json".format(filename),
                               '{}'.format(digest_bucket),
                               '{}.json'.format(filename))
                presign = s3.generate_presigned_url(
                    'get_object',
                    Params={
                        'Bucket': digest_bucket,
                        'Key': '{}.json'.format(filename)
                    },
                    ExpiresIn=604800)
                publish_to_sns(presign)
            except Exception as e:
                print(e)
        if output_format == 'csv':
            df.to_csv("/tmp/{}.csv".format(filename), index=False)
            try:
                s3.upload_file("/tmp/{}.csv".format(filename),
                               '{}'.format(digest_bucket),
                               '{}.csv'.format(filename))
                presign = s3.generate_presigned_url(
                    'get_object',
                    Params={
                        'Bucket': digest_bucket,
                        'Key': '{}.csv'.format(filename)
                    },
                    ExpiresIn=604800)
                publish_to_sns(presign)
            except Exception as e:
                print(e)
