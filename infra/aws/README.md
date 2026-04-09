# AWS CI/CD Bootstrap

This folder contains the company-side AWS bootstrap template for the shared dev pipeline.

## What it creates

- KMS-encrypted S3 artifact bucket
- SNS topic and email subscription
- ECR repositories for `frontend`, `backend`, and `nginx`
- CodeBuild projects for validation, promotion, and deployment
- CodePipeline wired to CodeCommit
- EventBridge trigger for pushes to `develop`

## Required secret

Store a JSON secret in AWS Secrets Manager and pass its ARN as `SnowflakeSecretArn`.

Expected shape:

```json
{
  "account": "YOUR_SNOWFLAKE_ACCOUNT",
  "user": "YOUR_DEPLOY_USER",
  "password": "YOUR_DEPLOY_PASSWORD",
  "warehouse": "COMPUTE_WH",
  "database": "AI_WORKBENCH_DEV",
  "schema": "APP_RUNTIME",
  "role": "AI_WORKBENCH_DEPLOYER",
  "compute_pool": "AI_WORKBENCH_DEV_POOL",
  "image_repository": "AI_WORKBENCH_DEV_IMAGES",
  "registry_host": "yourorg-youracct.registry.snowflakecomputing.com",
  "registry_username": "USER",
  "registry_password": "YOUR_PAT_OR_PASSWORD"
}
```

## Example deploy

```bash
aws cloudformation deploy \
  --stack-name bbi-ai-workbench-dev-cicd \
  --template-file infra/aws/cloudformation/dev-cicd.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    RepositoryName=bbi-mig-ai-workbench \
    BranchName=develop \
    NotificationEmail=team@example.com \
    SnowflakeSecretArn=arn:aws:secretsmanager:us-east-1:123456789012:secret:ai-workbench/dev/snowflake
```

