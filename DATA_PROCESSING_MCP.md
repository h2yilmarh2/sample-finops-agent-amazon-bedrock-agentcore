# Data Processing MCP Server (Athena/CUR Integration)

## Overview

This feature adds a third MCP server runtime to the FinOps Agent: the **AWS Data Processing MCP Server**. It enables the agent to query **AWS Cost and Usage Reports (CUR)** data via **Amazon Athena**, providing resource-level cost visibility with ARN-level granularity.

While the existing Billing MCP server provides account-level cost summaries via Cost Explorer, the Data Processing MCP server enables queries like:

- "What are the 10 most expensive resources this month?"
- "How much is resource `arn:aws:ec2:us-east-1:123456789012:instance/i-abc123` costing?"
- "Show me all S3 buckets with costs above $100 in the last 30 days"
- "Break down data transfer costs by resource"

### How it works

```
User: "What are my top 10 most expensive EC2 instances?"
  │
  ▼
Agent (LLM): calls get_table_metadata() → discovers CUR schema columns
  │
  ▼
Agent (LLM): generates SQL query against CUR table
  │
  ▼
Agent: calls start_query_execution(sql) → Athena runs the query
  │
  ▼
Agent: calls get_query_execution(id) → checks query status
  │
  ▼
Agent: calls get_query_results(id) → retrieves ARNs + costs
  │
  ▼
Agent: presents results to the user with resource ARNs and cost breakdown
```

The agent's LLM generates SQL dynamically based on the user's natural language question and the CUR table schema. The Data Processing MCP server handles execution and result retrieval.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   AgentCore Gateway                       │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐ │
│  │ Billing  │  │ Pricing  │  │ Data Processing       │ │
│  │ MCP      │  │ MCP      │  │ MCP (Athena/Glue)     │ │
│  └──────────┘  └──────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   Amazon Athena      │
                              │   (SQL Engine)       │
                              └──────────┬──────────┘
                                         │
                          ┌──────────────┼──────────────┐
                          ▼              ▼              ▼
                   ┌───────────┐  ┌───────────┐  ┌──────────┐
                   │ AWS Glue  │  │ S3 Bucket │  │ S3 Bucket│
                   │ Catalog   │  │ (CUR Data)│  │ (Results)│
                   └───────────┘  └───────────┘  └──────────┘
```

## Prerequisites

In addition to the base FinOps Agent prerequisites, you need:

1. **AWS Cost and Usage Report (CUR)** configured and delivering to an S3 bucket
2. **AWS Glue Data Catalog** table pointing to the CUR data (created automatically by CUR or via a Glue Crawler)
3. **Amazon Athena workgroup** with a configured output location (or a dedicated S3 bucket for query results)

### Setting up CUR (if not already configured)

If you don't have CUR set up:

1. Go to **AWS Billing Console** → **Cost & Usage Reports** → **Create report**
2. Select **Include resource IDs** (required for ARN-level visibility)
3. Choose **Parquet** format with **Snappy** compression (recommended for Athena performance)
4. Configure S3 delivery bucket and prefix
5. Wait for the first report delivery (up to 24 hours)
6. Create a Glue Crawler or use the CUR-provided Glue integration to create the table

## Configuration

The Data Processing MCP server requires the following environment variables:

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ATHENA_DATABASE` | ✅ | Glue database name containing the CUR table | `athenacurcfn_my_cur` |
| `ATHENA_TABLE` | ✅ | Table name within the database | `my_cur_report` |
| `ATHENA_OUTPUT_BUCKET` | ✅ | S3 location for Athena query results | `s3://my-athena-results-bucket` |
| `CUR_S3_BUCKET` | ✅ | S3 bucket where CUR data is stored | `my-cur-data-bucket` |
| `CUR_S3_PREFIX` | No | S3 prefix within the CUR bucket (empty string if none) | `cur/reports/` |
| `ATHENA_WORKGROUP` | No | Athena workgroup to use (defaults to `primary`) | `finops-workgroup` |

## Deployment

### Step 1: Set environment variables

```bash
export ADMIN_EMAIL="your-email@example.com"
export ATHENA_DATABASE="your-cur-database-name"
export ATHENA_TABLE="your-cur-table-name"
export ATHENA_OUTPUT_BUCKET="s3://your-athena-results-bucket"
export CUR_S3_BUCKET="your-cur-s3-bucket-name"
export CUR_S3_PREFIX=""  # optional, leave empty if no prefix
export ATHENA_WORKGROUP="primary"  # optional, defaults to 'primary'
```

### Step 2: Build and deploy

```bash
cd cdk
npm install
npm run build
npx cdk deploy --all --require-approval never
```

## Available MCP Tools

The Data Processing MCP server exposes the following tool categories via the [AWS Labs Data Processing MCP Server](https://awslabs.github.io/mcp/servers/aws-dataprocessing-mcp-server):

### Amazon Athena

| Tool | Description |
|------|-------------|
| `start_query_execution` | Execute SQL queries against CUR data |
| `get_query_execution` | Check query status (running/succeeded/failed) |
| `get_query_results` | Retrieve query results |
| `stop_query_execution` | Cancel a running query |
| `list_databases` | List available Glue databases |
| `list_table_metadata` | List tables in a database |
| `get_table_metadata` | Get column schema for a table (CUR schema discovery) |
| `get_named_query` | Retrieve saved queries |
| `list_work_groups` | List Athena workgroups |

### AWS Glue Data Catalog

| Tool | Description |
|------|-------------|
| `get_database` | Get database details |
| `get_tables` | List tables with metadata |
| `get_table` | Get full table schema |
| `get_partitions` | List table partitions (useful for CUR date partitions) |
| `search_tables` | Search tables by name or properties |

## IAM Permissions

The Data Processing MCP runtime role includes:

```
athena:StartQueryExecution, GetQueryExecution, GetQueryResults, StopQueryExecution
athena:ListQueryExecutions, GetWorkGroup, ListWorkGroups, ListDatabases
athena:ListTableMetadata, GetTableMetadata, GetDatabase, ListNamedQueries, GetNamedQuery
glue:GetDatabase, GetDatabases, GetTable, GetTables, GetPartition, GetPartitions, SearchTables
s3:GetObject, ListBucket, GetBucketLocation, PutObject
```

## Example Queries

Once deployed, you can ask the agent questions like:

| Question | What happens |
|----------|-------------|
| "What are my top 10 resources by cost this month?" | Agent queries CUR `line_item_resource_id` grouped by `line_item_unblended_cost` |
| "Show me all idle EC2 instances costing more than $50/month" | Agent filters by `product_product_name = 'Amazon Elastic Compute Cloud'` and cost threshold |
| "What's my data transfer cost breakdown by resource?" | Agent filters `usage_type` containing `DataTransfer` and groups by resource ARN |
| "Compare costs for resource X between last month and this month" | Agent queries two time periods and compares |

## Cost Impact

Adding the Data Processing MCP server increases the monthly cost by approximately:

| Component | Additional Cost |
|-----------|----------------|
| AgentCore Runtime (1 additional) | ~$25.00/month |
| Amazon Athena queries | ~$5.00/month (depends on data scanned) |
| S3 (query results) | ~$0.01/month |
| ECR (1 additional image) | ~$0.03/month |
| **Total additional cost** | **~$30.04/month** |

## Limitations

- CUR data has a delivery delay of up to 24 hours — the most recent day may not be available
- Large queries scanning full CUR datasets can be slow; use partition filters (`year`, `month`) for better performance
- The MCP server does not modify CUR data — it is read-only
- Athena has a concurrent query limit (default 20) — high-frequency usage may require a limit increase
