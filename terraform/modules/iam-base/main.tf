# IAM Base Module - Foundational IAM policies for EKS workloads

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Policy for S3 data lake access
resource "aws_iam_policy" "s3_data_access" {
  name        = "${var.lab_name}-s3-data-access"
  description = "Policy for accessing lakehouse data bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ListBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [var.data_bucket_arn]
      },
      {
        Sid    = "ReadWriteObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObjectVersion",
          "s3:GetObjectTagging",
          "s3:PutObjectTagging"
        ]
        Resource = ["${var.data_bucket_arn}/*"]
      }
    ]
  })

  tags = {
    Name = "${var.lab_name}-s3-data-access"
  }
}

# Policy for S3 logs access (read-only)
resource "aws_iam_policy" "s3_logs_access" {
  name        = "${var.lab_name}-s3-logs-access"
  description = "Policy for accessing logs bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ListBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [var.logs_bucket_arn]
      },
      {
        Sid    = "WriteObjects"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = ["${var.logs_bucket_arn}/*"]
      }
    ]
  })

  tags = {
    Name = "${var.lab_name}-s3-logs-access"
  }
}

# Policy for Aurora access via IAM authentication
resource "aws_iam_policy" "aurora_access" {
  name        = "${var.lab_name}-aurora-access"
  description = "Policy for Aurora IAM authentication"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AuroraConnect"
        Effect = "Allow"
        Action = [
          "rds-db:connect"
        ]
        Resource = [
          "arn:aws:rds-db:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:dbuser:${var.aurora_cluster_id}/*"
        ]
      },
      {
        Sid    = "SecretsAccess"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [var.aurora_secret_arn]
      }
    ]
  })

  tags = {
    Name = "${var.lab_name}-aurora-access"
  }
}

# Combined policy for Polaris service
resource "aws_iam_policy" "polaris_access" {
  name        = "${var.lab_name}-polaris-access"
  description = "Combined policy for Polaris service (S3 + Aurora)"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 data access
      {
        Sid    = "S3ListBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [var.data_bucket_arn]
      },
      {
        Sid    = "S3ReadWriteObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObjectVersion"
        ]
        Resource = ["${var.data_bucket_arn}/*"]
      },
      # Aurora secrets access
      {
        Sid    = "SecretsAccess"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [var.aurora_secret_arn]
      }
    ]
  })

  tags = {
    Name = "${var.lab_name}-polaris-access"
  }
}
