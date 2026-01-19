variable "lab_name" {
  description = "Unique name for this lab environment"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "aurora_instance_class" {
  description = "Aurora instance class (ignored for Serverless v2)"
  type        = string
  default     = "db.t4g.medium"
}

variable "aurora_min_capacity" {
  description = "Minimum ACUs for Aurora Serverless v2"
  type        = number
  default     = 0.5
}

variable "aurora_max_capacity" {
  description = "Maximum ACUs for Aurora Serverless v2"
  type        = number
  default     = 2
}

variable "data_bucket_name" {
  description = "Name for the data lake bucket"
  type        = string
}

variable "logs_bucket_name" {
  description = "Name for the logs bucket"
  type        = string
}
