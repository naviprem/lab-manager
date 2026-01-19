variable "aws_region" {
  type = string
}

variable "environment" {
  type = string
}

variable "lab_name" {
  type = string
}

variable "state_bucket" {
  type        = string
  description = "Bucket containing foundation state"
}

variable "eks_instance_types" {
  type    = list(string)
  default = ["t3.medium"]
}

variable "eks_desired_size" {
  type    = number
  default = 2
}
