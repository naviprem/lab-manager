variable "lab_name" {
  description = "Unique name for this lab environment"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "vpc_id" {
  description = "ID of the VPC"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block of the VPC"
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of private subnets for the Aurora cluster"
  type        = list(string)
}

variable "min_capacity" {
  description = "Minimum ACUs for Serverless v2"
  type        = number
  default     = 0.5
}

variable "max_capacity" {
  description = "Maximum ACUs for Serverless v2"
  type        = number
  default     = 2
}
