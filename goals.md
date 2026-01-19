# Lab Manager Goals

Building a cloud-native laboratory for exploratory data engineering, featuring an ephemeral EKS-based runtime, persistent metadata/data layers, and a robust security stack.

## Core Requirements

### 1. Hybrid Infrastructure (AWS)
- **Ephemeral EKS Cluster**: Automated spin-up for experiments and full teardown for cost optimization.
- **Persistent Metadata Layer**: **AWS Aurora PostgreSQL** to store:
    - **Apache Polaris** metadata.
    - **Keycloak** identity and configuration data.
    - **Governance** policies and state.
- **Persistent Data Layer**: **AWS S3** as the primary storage for Iceberg tables.
- **Infrastructure as Code (IaC)**: Terraform scripts to manage the lifecycle of both persistent (Aurora, S3, IAM) and ephemeral (EKS) resources.

### 2. Lakehouse Core Components
- **Catalog Strategy**: 
    - **Apache Polaris**: Running on EKS, acting as the vendor-neutral Iceberg catalog.
    - Connected to the persistent Aurora DB.
- **Compute Engines (Ephemeral)**: 
    - **Spark on K8s**: Specialized node groups for heavy data processing.
    - **Trino**: Fast SQL engine for exploring S3-backed Iceberg tables via Polaris.
- **Table Formats**: Standardized on **Apache Iceberg**.

### 3. Security, Governance & AI
- **Authentication (AuthN)**: **Keycloak** deployed on EKS with pre-configured realms, client IDs, and **sample users/roles**.
- **Authorization (AuthZ)**: **Open Policy Agent (OPA)** with **sample Rego policies** (e.g., row-level filtering for Trino).
- **Agentic AI**: **LangGraph** integration for building complex inference workflows that interact with the Lakehouse.
- **Catalog Management**: Polaris-native REST API pre-seeded with **sample Iceberg tables** and namespaces.

### 4. Sample Applications & Showcase
- **Data Visualization App**: A full-stack application (e.g., React + Fast API/Node) to visualize Iceberg data, integrated with Keycloak for AuthN.
- **AI Inference Workflow**: A demo using LangGraph to show "Agentic Data Analysis" over the Iceberg tables.

### 5. Lab Lifecycle CLI (`lab`)
- **`lab bootstrap`**: Provisions the persistent foundations (Aurora, S3, IAM, VPC).
- **`lab up [components...]`**: Deploys EKS and core + requested components.
    - **Core**: EKS, Polaris, Keycloak, Sample Data/Users.
    - **Optional**: Trino, Spark, OPA, Viz-App, LangGraph-Worker.
- **`lab seed`**: Re-populates sample tables, users, and OPA policies without rebuilding infra.
- **`lab down`**: Tears down the EKS cluster but keeps everything in Aurora and S3 intact.

## Design Principles
- **Batteries Included**: The lab isn't just infra; it's a working demo with data, users, and apps on "Day 1".
- **Modularity**: Components and apps are "pluggable."
- **Separation of Compute and State**: EKS is cattle; Aurora/S3 is pets.
- **Zero Trust Foundation**: Every component integrated with Keycloak/OPA from the start.
- **Reproducibility**: Every `lab up` results in an identical environment connected to the existing state.
