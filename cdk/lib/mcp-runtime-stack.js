"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPRuntimeStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const cdk_nag_1 = require("cdk-nag");
class MCPRuntimeStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========================================
        // IAM Roles for MCP Runtimes
        // ========================================
        // Billing MCP Server Runtime Role
        const billingMcpRuntimeRole = new iam.Role(this, 'BillingMcpRuntimeRole', {
            roleName: `${this.stackName}-BillingMcpRuntimeRole`,
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Pricing MCP Server Runtime Role
        const pricingMcpRuntimeRole = new iam.Role(this, 'PricingMcpRuntimeRole', {
            roleName: `${this.stackName}-PricingMcpRuntimeRole`,
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Common AgentCore Runtime permissions (ECR, CloudWatch, X-Ray, Bedrock, Gateway)
        const commonRuntimePermissions = [
            // ECR token access
            new iam.PolicyStatement({
                sid: 'ECRTokenAccess',
                effect: iam.Effect.ALLOW,
                actions: ['ecr:GetAuthorizationToken'],
                resources: ['*'],
            }),
            // CloudWatch Logs
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:DescribeLogGroups'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
            }),
            // Gateway invocation
            new iam.PolicyStatement({
                sid: 'AllowGatewayInvocation',
                effect: iam.Effect.ALLOW,
                actions: ['bedrock-agentcore:InvokeGateway'],
                resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`],
            }),
        ];
        // Add common permissions to both roles
        for (const stmt of commonRuntimePermissions) {
            billingMcpRuntimeRole.addToPolicy(stmt);
            pricingMcpRuntimeRole.addToPolicy(stmt);
        }
        // ECR image pull for each role's specific repository
        props.billingMcpRepository.grantPull(billingMcpRuntimeRole);
        props.pricingMcpRepository.grantPull(pricingMcpRuntimeRole);
        // Add Cost Explorer and billing permissions to Billing MCP Runtime
        billingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ce:*',
                'budgets:*',
                'compute-optimizer:*',
                'freetier:*',
                'cost-optimization-hub:*',
                'pricing:GetProducts',
                'pricing:GetAttributeValues',
                'pricing:DescribeServices',
                'pricing:ListPriceListFiles',
                'pricing:GetPriceListFileUrl',
                'ec2:DescribeInstances',
                'ec2:DescribeVolumes',
                'ec2:DescribeInstanceTypes',
                'ec2:DescribeRegions',
                'autoscaling:DescribeAutoScalingGroups',
                'lambda:ListFunctions',
                'lambda:GetFunction',
                'ecs:ListClusters',
                'ecs:ListServices',
                'ecs:DescribeServices',
            ],
            resources: ['*'],
        }));
        // Add Pricing API permissions to Pricing MCP Runtime
        pricingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'pricing:GetProducts',
                'pricing:GetAttributeValues',
                'pricing:DescribeServices',
                'pricing:ListPriceListFiles',
                'pricing:GetPriceListFileUrl',
            ],
            resources: ['*'],
        }));
        // ========================================
        // MCP Runtimes with JWT Authorization
        // Gateway sends OAuth Bearer tokens, Runtimes validate JWT
        // ========================================
        // Billing MCP Server Runtime
        const cfnBillingMcpRuntime = new cdk.CfnResource(this, 'BillingMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'finops_billing_mcp_jwt_v1',
                Description: 'AWS Labs Billing MCP Server Runtime with JWT authorization',
                RoleArn: billingMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.billingMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnBillingMcpRuntime.node.addDependency(billingMcpRuntimeRole);
        this.billingMcpRuntimeArn = cfnBillingMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
        const encodedBillingArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.billingMcpRuntimeArn)))),
        ]);
        this.billingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedBillingArn}/invocations?qualifier=DEFAULT`;
        // Pricing MCP Server Runtime
        const cfnPricingMcpRuntime = new cdk.CfnResource(this, 'PricingMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'finops_pricing_mcp_jwt_v1',
                Description: 'AWS Labs Pricing MCP Server Runtime with JWT authorization',
                RoleArn: pricingMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.pricingMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: {
                    AWS_REGION: this.region,
                    DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
                },
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnPricingMcpRuntime.node.addDependency(pricingMcpRuntimeRole);
        this.pricingMcpRuntimeArn = cfnPricingMcpRuntime.getAtt('AgentRuntimeArn').toString();
        // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
        // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
        // The ARN must be URL-encoded (: → %3A, / → %2F)
        // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
        const encodedPricingArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.pricingMcpRuntimeArn)))),
        ]);
        this.pricingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedPricingArn}/invocations?qualifier=DEFAULT`;
        // ========================================
        // Data Processing MCP Server Runtime
        // ========================================
        const dataProcessingMcpRuntimeRole = new iam.Role(this, 'DataProcessingMcpRuntimeRole', {
            roleName: `${this.stackName}-DataProcessingMcpRuntimeRole`,
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
        });
        // Add common permissions
        for (const stmt of commonRuntimePermissions) {
            dataProcessingMcpRuntimeRole.addToPolicy(stmt);
        }
        props.dataProcessingMcpRepository.grantPull(dataProcessingMcpRuntimeRole);
        // Athena permissions
        dataProcessingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'athena:StartQueryExecution',
                'athena:GetQueryExecution',
                'athena:GetQueryResults',
                'athena:StopQueryExecution',
                'athena:ListQueryExecutions',
                'athena:GetWorkGroup',
                'athena:ListWorkGroups',
                'athena:ListNamedQueries',
                'athena:GetNamedQuery',
                'athena:ListDatabases',
                'athena:ListTableMetadata',
                'athena:GetTableMetadata',
                'athena:GetDatabase',
            ],
            resources: ['*'],
        }));
        // Glue Catalog permissions
        dataProcessingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'glue:GetDatabase',
                'glue:GetDatabases',
                'glue:GetTable',
                'glue:GetTables',
                'glue:GetPartition',
                'glue:GetPartitions',
                'glue:SearchTables',
            ],
            resources: ['*'],
        }));
        // S3 permissions for CUR bucket and Athena results
        const s3Resources = ['arn:aws:s3:::*'];
        const s3ObjectResources = ['arn:aws:s3:::*/*'];
        dataProcessingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject',
                's3:ListBucket',
                's3:GetBucketLocation',
                's3:PutObject',
            ],
            resources: [...s3Resources, ...s3ObjectResources],
        }));
        // Environment variables for the runtime
        const dataProcessingEnvVars = {
            AWS_REGION: this.region,
            DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
            ATHENA_DATABASE: props.athenaDatabase,
            ATHENA_TABLE: props.athenaTable,
            ATHENA_OUTPUT_BUCKET: props.athenaOutputBucket,
            CUR_S3_BUCKET: props.curS3Bucket,
            CUR_S3_PREFIX: props.curS3Prefix,
        };
        const cfnDataProcessingMcpRuntime = new cdk.CfnResource(this, 'DataProcessingMcpRuntime', {
            type: 'AWS::BedrockAgentCore::Runtime',
            properties: {
                AgentRuntimeName: 'finops_dataprocessing_mcp_jwt_v1',
                Description: 'AWS Labs Data Processing MCP Server Runtime (Athena/Glue) with JWT authorization',
                RoleArn: dataProcessingMcpRuntimeRole.roleArn,
                AuthorizerConfiguration: {
                    CustomJWTAuthorizer: {
                        AllowedClients: [props.m2mClientId],
                        DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
                    }
                },
                AgentRuntimeArtifact: {
                    ContainerConfiguration: {
                        ContainerUri: `${props.dataProcessingMcpRepository.repositoryUri}:latest`
                    }
                },
                NetworkConfiguration: {
                    NetworkMode: 'PUBLIC'
                },
                EnvironmentVariables: dataProcessingEnvVars,
                ProtocolConfiguration: 'MCP',
                LifecycleConfiguration: {},
            }
        });
        cfnDataProcessingMcpRuntime.node.addDependency(dataProcessingMcpRuntimeRole);
        this.dataProcessingMcpRuntimeArn = cfnDataProcessingMcpRuntime.getAtt('AgentRuntimeArn').toString();
        const encodedDataProcessingArn = cdk.Fn.join('', [
            cdk.Fn.select(0, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(1, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(2, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(3, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.select(4, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
            '%3A',
            cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)))),
        ]);
        this.dataProcessingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedDataProcessingArn}/invocations?qualifier=DEFAULT`;
        // ========================================
        // Outputs
        // ========================================
        new cdk.CfnOutput(this, 'BillingMcpRuntimeArn', {
            value: this.billingMcpRuntimeArn,
            description: 'Billing MCP Server Runtime ARN',
            exportName: `${this.stackName}-BillingMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'BillingMcpRuntimeEndpoint', {
            value: this.billingMcpRuntimeEndpoint,
            description: 'Billing MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-BillingMcpRuntimeEndpoint`,
        });
        new cdk.CfnOutput(this, 'PricingMcpRuntimeArn', {
            value: this.pricingMcpRuntimeArn,
            description: 'Pricing MCP Server Runtime ARN',
            exportName: `${this.stackName}-PricingMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'PricingMcpRuntimeEndpoint', {
            value: this.pricingMcpRuntimeEndpoint,
            description: 'Pricing MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-PricingMcpRuntimeEndpoint`,
        });
        new cdk.CfnOutput(this, 'DataProcessingMcpRuntimeArn', {
            value: this.dataProcessingMcpRuntimeArn,
            description: 'Data Processing MCP Server Runtime ARN',
            exportName: `${this.stackName}-DataProcessingMcpRuntimeArn`,
        });
        new cdk.CfnOutput(this, 'DataProcessingMcpRuntimeEndpoint', {
            value: this.dataProcessingMcpRuntimeEndpoint,
            description: 'Data Processing MCP Server Runtime Endpoint',
            exportName: `${this.stackName}-DataProcessingMcpRuntimeEndpoint`,
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(billingMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for Cost Explorer APIs (account-level services), ECR auth token, CloudWatch, X-Ray',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(pricingMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for AWS Pricing API (global service), ECR auth token, CloudWatch, X-Ray',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(dataProcessingMcpRuntimeRole, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for Athena, Glue Catalog, S3 (CUR data + query results), ECR auth token, CloudWatch',
            },
        ], true);
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-L1',
                reason: 'Python 3.14 is the latest Lambda runtime version available',
            },
            {
                id: 'AwsSolutions-IAM4',
                reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions',
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Wildcard permissions required for custom resource Lambda functions',
            },
        ]);
    }
}
exports.MCPRuntimeStack = MCPRuntimeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXJ1bnRpbWUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJtY3AtcnVudGltZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMseURBQTJDO0FBRzNDLHFDQUEwQztBQWlCMUMsTUFBYSxlQUFnQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBUTVDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBMkI7UUFDbkUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsMkNBQTJDO1FBQzNDLDZCQUE2QjtRQUM3QiwyQ0FBMkM7UUFFM0Msa0NBQWtDO1FBQ2xDLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUN4RSxRQUFRLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyx3QkFBd0I7WUFDbkQsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLGlDQUFpQyxDQUFDO1NBQ3ZFLENBQUMsQ0FBQztRQUVILGtDQUFrQztRQUNsQyxNQUFNLHFCQUFxQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDeEUsUUFBUSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsd0JBQXdCO1lBQ25ELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxpQ0FBaUMsQ0FBQztTQUN2RSxDQUFDLENBQUM7UUFFSCxrRkFBa0Y7UUFDbEYsTUFBTSx3QkFBd0IsR0FBMEI7WUFDdEQsbUJBQW1CO1lBQ25CLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQkFDdEIsR0FBRyxFQUFFLGdCQUFnQjtnQkFDckIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQkFD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QyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLDJCQUEyQixDQUFDLENBQUM7WUFDckUsS0FBSztZQUNMLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLDJCQUEyQixDQUFDLENBQUM7WUFDckUsS0FBSztZQUNMLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLDJCQUEyQixDQUFDLENBQUM7WUFDckUsS0FBSztZQUNMLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLDJCQUEyQixDQUFDLENBQUM7WUFDckUsS0FBSztZQUNMLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLDJCQUEyQixDQUFDLENBQUM7WUFDckUsS0FBSztZQUNMLEdBQUcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDN0csQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLGdDQUFnQyxHQUFHLDZCQUE2QixJQUFJLENBQUMsTUFBTSwyQkFBMkIsd0JBQXdCLGdDQUFnQyxDQUFDO1FBRXBLLDJDQUEyQztRQUMzQyxVQUFVO1FBQ1YsMkNBQTJDO1FBRTNDLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDOUMsS0FBSyxFQUFFLElBQUksQ0FBQyxvQkFBb0I7WUFDaEMsV0FBVyxFQUFFLGdDQUFnQztZQUM3QyxVQUFVLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyx1QkFBdUI7U0FDckQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUNuRCxLQUFLLEVBQUUsSUFBSSxDQUFDLHlCQUF5QjtZQUNyQyxXQUFXLEVBQUUscUNBQXFDO1lBQ2xELFVBQVUsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLDRCQUE0QjtTQUMxRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQzlDLEtBQUssRUFBRSxJQUFJLENBQUMsb0JBQW9CO1lBQ2hDLFdBQVcsRUFBRSxnQ0FBZ0M7WUFDN0MsVUFBVSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsdUJBQXVCO1NBQ3JELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLEVBQUU7WUFDbkQsS0FBSyxFQUFFLElBQUksQ0FBQyx5QkFBeUI7WUFDckMsV0FBVyxFQUFFLHFDQUFxQztZQUNsRCxVQUFVLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyw0QkFBNEI7U0FDMUQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSw2QkFBNkIsRUFBRTtZQUNyRCxLQUFLLEVBQUUsSUFBSSxDQUFDLDJCQUEyQjtZQUN2QyxXQUFXLEVBQUUsd0NBQXdDO1lBQ3JELFVBQVUsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLDhCQUE4QjtTQUM1RCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtDQUFrQyxFQUFFO1lBQzFELEtBQUssRUFBRSxJQUFJLENBQUMsZ0NBQWdDO1lBQzVDLFdBQVcsRUFBRSw2Q0FBNkM7WUFDMUQsVUFBVSxFQUFFLEdBQUcsSUFBSSxDQUFDLFNBQVMsbUNBQW1DO1NBQ2pFLENBQUMsQ0FBQztRQUVILDJDQUEyQztRQUMzQyx1QkFBdUI7UUFDdkIsMkNBQTJDO1FBRTNDLHlCQUFlLENBQUMsdUJBQXVCLENBQUMscUJBQXFCLEVBQUU7WUFDN0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLGtIQUFrSDthQUMzSDtTQUNGLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFVCx5QkFBZSxDQUFDLHVCQUF1QixDQUFDLHFCQUFxQixFQUFFO1lBQzdEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSx1R0FBdUc7YUFDaEg7U0FDRixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRVQseUJBQWUsQ0FBQyx1QkFBdUIsQ0FBQyw0QkFBNEIsRUFBRTtZQUNwRTtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsbUhBQW1IO2FBQzVIO1NBQ0YsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVULHlCQUFlLENBQUMsb0JBQW9CLENBQUMsSUFBSSxFQUFFO1lBQ3pDO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw0REFBNEQ7YUFDckU7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsc0ZBQXNGO2FBQy9GO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG9FQUFvRTthQUM3RTtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXRhRCwwQ0FzYUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJztcblxuZXhwb3J0IGludGVyZmFjZSBNQ1BSdW50aW1lU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgYmlsbGluZ01jcFJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgcHJpY2luZ01jcFJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgZGF0YVByb2Nlc3NpbmdNY3BSZXBvc2l0b3J5OiBlY3IuSVJlcG9zaXRvcnk7XG4gIC8vIEZyb20gQXV0aFN0YWNrIC0gZm9yIEpXVCBhdXRob3JpemF0aW9uIG9uIHJ1bnRpbWVzXG4gIHVzZXJQb29sSWQ6IHN0cmluZztcbiAgbTJtQ2xpZW50SWQ6IHN0cmluZztcbiAgLy8gRGF0YSBQcm9jZXNzaW5nIE1DUCBjb25maWd1cmF0aW9uXG4gIGF0aGVuYURhdGFiYXNlOiBzdHJpbmc7XG4gIGF0aGVuYVRhYmxlOiBzdHJpbmc7XG4gIGF0aGVuYU91dHB1dEJ1Y2tldDogc3RyaW5nO1xuICBjdXJTM0J1Y2tldDogc3RyaW5nO1xuICBjdXJTM1ByZWZpeDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgTUNQUnVudGltZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGJpbGxpbmdNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBwcmljaW5nTWNwUnVudGltZUFybjogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgYmlsbGluZ01jcFJ1bnRpbWVFbmRwb2ludDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgcHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBkYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVFbmRwb2ludDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBNQ1BSdW50aW1lU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIElBTSBSb2xlcyBmb3IgTUNQIFJ1bnRpbWVzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQmlsbGluZyBNQ1AgU2VydmVyIFJ1bnRpbWUgUm9sZVxuICAgIGNvbnN0IGJpbGxpbmdNY3BSdW50aW1lUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQmlsbGluZ01jcFJ1bnRpbWVSb2xlJywge1xuICAgICAgcm9sZU5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1CaWxsaW5nTWNwUnVudGltZVJvbGVgLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2JlZHJvY2stYWdlbnRjb3JlLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcblxuICAgIC8vIFByaWNpbmcgTUNQIFNlcnZlciBSdW50aW1lIFJvbGVcbiAgICBjb25zdCBwcmljaW5nTWNwUnVudGltZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1ByaWNpbmdNY3BSdW50aW1lUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tUHJpY2luZ01jcFJ1bnRpbWVSb2xlYCxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdiZWRyb2NrLWFnZW50Y29yZS5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG5cbiAgICAvLyBDb21tb24gQWdlbnRDb3JlIFJ1bnRpbWUgcGVybWlzc2lvbnMgKEVDUiwgQ2xvdWRXYXRjaCwgWC1SYXksIEJlZHJvY2ssIEdhdGV3YXkpXG4gICAgY29uc3QgY29tbW9uUnVudGltZVBlcm1pc3Npb25zOiBpYW0uUG9saWN5U3RhdGVtZW50W10gPSBbXG4gICAgICAvLyBFQ1IgdG9rZW4gYWNjZXNzXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0VDUlRva2VuQWNjZXNzJyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pLFxuICAgICAgLy8gQ2xvdWRXYXRjaCBMb2dzXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydsb2dzOkRlc2NyaWJlTG9nR3JvdXBzJ10sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxvZ3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmxvZy1ncm91cDoqYF0sXG4gICAgICB9KSxcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJywgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvYmVkcm9jay1hZ2VudGNvcmUvcnVudGltZXMvKmBdLFxuICAgICAgfSksXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsICdsb2dzOlB1dExvZ0V2ZW50cyddLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9iZWRyb2NrLWFnZW50Y29yZS9ydW50aW1lcy8qOmxvZy1zdHJlYW06KmBdLFxuICAgICAgfSksXG4gICAgICAvLyBHYXRld2F5IGludm9jYXRpb25cbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnQWxsb3dHYXRld2F5SW52b2NhdGlvbicsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydiZWRyb2NrLWFnZW50Y29yZTpJbnZva2VHYXRld2F5J10sXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmJlZHJvY2stYWdlbnRjb3JlOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpnYXRld2F5LypgXSxcbiAgICAgIH0pLFxuICAgIF07XG5cbiAgICAvLyBBZGQgY29tbW9uIHBlcm1pc3Npb25zIHRvIGJvdGggcm9sZXNcbiAgICBmb3IgKGNvbnN0IHN0bXQgb2YgY29tbW9uUnVudGltZVBlcm1pc3Npb25zKSB7XG4gICAgICBiaWxsaW5nTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3koc3RtdCk7XG4gICAgICBwcmljaW5nTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3koc3RtdCk7XG4gICAgfVxuXG4gICAgLy8gRUNSIGltYWdlIHB1bGwgZm9yIGVhY2ggcm9sZSdzIHNwZWNpZmljIHJlcG9zaXRvcnlcbiAgICBwcm9wcy5iaWxsaW5nTWNwUmVwb3NpdG9yeS5ncmFudFB1bGwoYmlsbGluZ01jcFJ1bnRpbWVSb2xlKTtcbiAgICBwcm9wcy5wcmljaW5nTWNwUmVwb3NpdG9yeS5ncmFudFB1bGwocHJpY2luZ01jcFJ1bnRpbWVSb2xlKTtcblxuICAgIC8vIEFkZCBDb3N0IEV4cGxvcmVyIGFuZCBiaWxsaW5nIHBlcm1pc3Npb25zIHRvIEJpbGxpbmcgTUNQIFJ1bnRpbWVcbiAgICBiaWxsaW5nTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnY2U6KicsXG4gICAgICAgICdidWRnZXRzOionLFxuICAgICAgICAnY29tcHV0ZS1vcHRpbWl6ZXI6KicsXG4gICAgICAgICdmcmVldGllcjoqJyxcbiAgICAgICAgJ2Nvc3Qtb3B0aW1pemF0aW9uLWh1YjoqJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJvZHVjdHMnLFxuICAgICAgICAncHJpY2luZzpHZXRBdHRyaWJ1dGVWYWx1ZXMnLFxuICAgICAgICAncHJpY2luZzpEZXNjcmliZVNlcnZpY2VzJyxcbiAgICAgICAgJ3ByaWNpbmc6TGlzdFByaWNlTGlzdEZpbGVzJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJpY2VMaXN0RmlsZVVybCcsXG4gICAgICAgICdlYzI6RGVzY3JpYmVJbnN0YW5jZXMnLFxuICAgICAgICAnZWMyOkRlc2NyaWJlVm9sdW1lcycsXG4gICAgICAgICdlYzI6RGVzY3JpYmVJbnN0YW5jZVR5cGVzJyxcbiAgICAgICAgJ2VjMjpEZXNjcmliZVJlZ2lvbnMnLFxuICAgICAgICAnYXV0b3NjYWxpbmc6RGVzY3JpYmVBdXRvU2NhbGluZ0dyb3VwcycsXG4gICAgICAgICdsYW1iZGE6TGlzdEZ1bmN0aW9ucycsXG4gICAgICAgICdsYW1iZGE6R2V0RnVuY3Rpb24nLFxuICAgICAgICAnZWNzOkxpc3RDbHVzdGVycycsXG4gICAgICAgICdlY3M6TGlzdFNlcnZpY2VzJyxcbiAgICAgICAgJ2VjczpEZXNjcmliZVNlcnZpY2VzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBQcmljaW5nIEFQSSBwZXJtaXNzaW9ucyB0byBQcmljaW5nIE1DUCBSdW50aW1lXG4gICAgcHJpY2luZ01jcFJ1bnRpbWVSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJvZHVjdHMnLFxuICAgICAgICAncHJpY2luZzpHZXRBdHRyaWJ1dGVWYWx1ZXMnLFxuICAgICAgICAncHJpY2luZzpEZXNjcmliZVNlcnZpY2VzJyxcbiAgICAgICAgJ3ByaWNpbmc6TGlzdFByaWNlTGlzdEZpbGVzJyxcbiAgICAgICAgJ3ByaWNpbmc6R2V0UHJpY2VMaXN0RmlsZVVybCcsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTUNQIFJ1bnRpbWVzIHdpdGggSldUIEF1dGhvcml6YXRpb25cbiAgICAvLyBHYXRld2F5IHNlbmRzIE9BdXRoIEJlYXJlciB0b2tlbnMsIFJ1bnRpbWVzIHZhbGlkYXRlIEpXVFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIEJpbGxpbmcgTUNQIFNlcnZlciBSdW50aW1lXG4gICAgY29uc3QgY2ZuQmlsbGluZ01jcFJ1bnRpbWUgPSBuZXcgY2RrLkNmblJlc291cmNlKHRoaXMsICdCaWxsaW5nTWNwUnVudGltZScsIHtcbiAgICAgIHR5cGU6ICdBV1M6OkJlZHJvY2tBZ2VudENvcmU6OlJ1bnRpbWUnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBBZ2VudFJ1bnRpbWVOYW1lOiAnZmlub3BzX2JpbGxpbmdfbWNwX2p3dF92MScsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQVdTIExhYnMgQmlsbGluZyBNQ1AgU2VydmVyIFJ1bnRpbWUgd2l0aCBKV1QgYXV0aG9yaXphdGlvbicsXG4gICAgICAgIFJvbGVBcm46IGJpbGxpbmdNY3BSdW50aW1lUm9sZS5yb2xlQXJuLFxuICAgICAgICBBdXRob3JpemVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIEN1c3RvbUpXVEF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIEFsbG93ZWRDbGllbnRzOiBbcHJvcHMubTJtQ2xpZW50SWRdLFxuICAgICAgICAgICAgRGlzY292ZXJ5VXJsOiBgaHR0cHM6Ly9jb2duaXRvLWlkcC4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cHJvcHMudXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgQWdlbnRSdW50aW1lQXJ0aWZhY3Q6IHtcbiAgICAgICAgICBDb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJVcmk6IGAke3Byb3BzLmJpbGxpbmdNY3BSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OmxhdGVzdGBcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIE5ldHdvcmtDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgTmV0d29ya01vZGU6ICdQVUJMSUMnXG4gICAgICAgIH0sXG4gICAgICAgIEVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgQVdTX1JFR0lPTjogdGhpcy5yZWdpb24sXG4gICAgICAgICAgREVQTE9ZTUVOVF9USU1FU1RBTVA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSxcbiAgICAgICAgUHJvdG9jb2xDb25maWd1cmF0aW9uOiAnTUNQJyxcbiAgICAgICAgTGlmZWN5Y2xlQ29uZmlndXJhdGlvbjoge30sXG4gICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgY2ZuQmlsbGluZ01jcFJ1bnRpbWUubm9kZS5hZGREZXBlbmRlbmN5KGJpbGxpbmdNY3BSdW50aW1lUm9sZSk7XG5cbiAgICB0aGlzLmJpbGxpbmdNY3BSdW50aW1lQXJuID0gY2ZuQmlsbGluZ01jcFJ1bnRpbWUuZ2V0QXR0KCdBZ2VudFJ1bnRpbWVBcm4nKS50b1N0cmluZygpO1xuICAgIC8vIE1DUCBSdW50aW1lIGVuZHBvaW50IGZvcm1hdCBmb3IgQWdlbnRDb3JlIEdhdGV3YXkgdGFyZ2V0cyAoZnJvbSBBV1MgZG9jdW1lbnRhdGlvbilcbiAgICAvLyBGb3JtYXQ6IGh0dHBzOi8vYmVkcm9jay1hZ2VudGNvcmUue3JlZ2lvbn0uYW1hem9uYXdzLmNvbS9ydW50aW1lcy97RU5DT0RFRF9BUk59L2ludm9jYXRpb25zP3F1YWxpZmllcj1ERUZBVUxUXG4gICAgLy8gVGhlIEFSTiBtdXN0IGJlIFVSTC1lbmNvZGVkICg6IOKGkiAlM0EsIC8g4oaSICUyRilcbiAgICAvLyBSZWZlcmVuY2U6IGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9iZWRyb2NrLWFnZW50Y29yZS9sYXRlc3QvZGV2Z3VpZGUvcnVudGltZS1tY3AuaHRtbFxuICAgIGNvbnN0IGVuY29kZWRCaWxsaW5nQXJuID0gY2RrLkZuLmpvaW4oJycsIFtcbiAgICAgIGNkay5Gbi5zZWxlY3QoMCwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDEsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuYmlsbGluZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgyLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmJpbGxpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMywgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDQsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuYmlsbGluZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLmpvaW4oJyUyRicsIGNkay5Gbi5zcGxpdCgnLycsIGNkay5Gbi5zZWxlY3QoNSwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5iaWxsaW5nTWNwUnVudGltZUFybikpKSksXG4gICAgXSk7XG4gICAgdGhpcy5iaWxsaW5nTWNwUnVudGltZUVuZHBvaW50ID0gYGh0dHBzOi8vYmVkcm9jay1hZ2VudGNvcmUuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS9ydW50aW1lcy8ke2VuY29kZWRCaWxsaW5nQXJufS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVGA7XG5cbiAgICAvLyBQcmljaW5nIE1DUCBTZXJ2ZXIgUnVudGltZVxuICAgIGNvbnN0IGNmblByaWNpbmdNY3BSdW50aW1lID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnUHJpY2luZ01jcFJ1bnRpbWUnLCB7XG4gICAgICB0eXBlOiAnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpSdW50aW1lJyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgQWdlbnRSdW50aW1lTmFtZTogJ2Zpbm9wc19wcmljaW5nX21jcF9qd3RfdjEnLFxuICAgICAgICBEZXNjcmlwdGlvbjogJ0FXUyBMYWJzIFByaWNpbmcgTUNQIFNlcnZlciBSdW50aW1lIHdpdGggSldUIGF1dGhvcml6YXRpb24nLFxuICAgICAgICBSb2xlQXJuOiBwcmljaW5nTWNwUnVudGltZVJvbGUucm9sZUFybixcbiAgICAgICAgQXV0aG9yaXplckNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBDdXN0b21KV1RBdXRob3JpemVyOiB7XG4gICAgICAgICAgICBBbGxvd2VkQ2xpZW50czogW3Byb3BzLm0ybUNsaWVudElkXSxcbiAgICAgICAgICAgIERpc2NvdmVyeVVybDogYGh0dHBzOi8vY29nbml0by1pZHAuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3Byb3BzLnVzZXJQb29sSWR9Ly53ZWxsLWtub3duL29wZW5pZC1jb25maWd1cmF0aW9uYCxcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIEFnZW50UnVudGltZUFydGlmYWN0OiB7XG4gICAgICAgICAgQ29udGFpbmVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgQ29udGFpbmVyVXJpOiBgJHtwcm9wcy5wcmljaW5nTWNwUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfTpsYXRlc3RgXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBOZXR3b3JrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIE5ldHdvcmtNb2RlOiAnUFVCTElDJ1xuICAgICAgICB9LFxuICAgICAgICBFbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICAgIEFXU19SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgICAgIERFUExPWU1FTlRfVElNRVNUQU1QOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0sXG4gICAgICAgIFByb3RvY29sQ29uZmlndXJhdGlvbjogJ01DUCcsXG4gICAgICAgIExpZmVjeWNsZUNvbmZpZ3VyYXRpb246IHt9LFxuICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIGNmblByaWNpbmdNY3BSdW50aW1lLm5vZGUuYWRkRGVwZW5kZW5jeShwcmljaW5nTWNwUnVudGltZVJvbGUpO1xuXG4gICAgdGhpcy5wcmljaW5nTWNwUnVudGltZUFybiA9IGNmblByaWNpbmdNY3BSdW50aW1lLmdldEF0dCgnQWdlbnRSdW50aW1lQXJuJykudG9TdHJpbmcoKTtcbiAgICAvLyBNQ1AgUnVudGltZSBlbmRwb2ludCBmb3JtYXQgZm9yIEFnZW50Q29yZSBHYXRld2F5IHRhcmdldHMgKGZyb20gQVdTIGRvY3VtZW50YXRpb24pXG4gICAgLy8gRm9ybWF0OiBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLntyZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMve0VOQ09ERURfQVJOfS9pbnZvY2F0aW9ucz9xdWFsaWZpZXI9REVGQVVMVFxuICAgIC8vIFRoZSBBUk4gbXVzdCBiZSBVUkwtZW5jb2RlZCAoOiDihpIgJTNBLCAvIOKGkiAlMkYpXG4gICAgLy8gUmVmZXJlbmNlOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vYmVkcm9jay1hZ2VudGNvcmUvbGF0ZXN0L2Rldmd1aWRlL3J1bnRpbWUtbWNwLmh0bWxcbiAgICBjb25zdCBlbmNvZGVkUHJpY2luZ0FybiA9IGNkay5Gbi5qb2luKCcnLCBbXG4gICAgICBjZGsuRm4uc2VsZWN0KDAsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgxLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLnByaWNpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMiwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5wcmljaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDMsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCg0LCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLnByaWNpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5qb2luKCclMkYnLCBjZGsuRm4uc3BsaXQoJy8nLCBjZGsuRm4uc2VsZWN0KDUsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVBcm4pKSkpLFxuICAgIF0pO1xuICAgIHRoaXMucHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCA9IGBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMvJHtlbmNvZGVkUHJpY2luZ0Fybn0vaW52b2NhdGlvbnM/cXVhbGlmaWVyPURFRkFVTFRgO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIERhdGEgUHJvY2Vzc2luZyBNQ1AgU2VydmVyIFJ1bnRpbWVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBkYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdEYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVSb2xlJywge1xuICAgICAgcm9sZU5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1EYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVSb2xlYCxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdiZWRyb2NrLWFnZW50Y29yZS5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY29tbW9uIHBlcm1pc3Npb25zXG4gICAgZm9yIChjb25zdCBzdG10IG9mIGNvbW1vblJ1bnRpbWVQZXJtaXNzaW9ucykge1xuICAgICAgZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lUm9sZS5hZGRUb1BvbGljeShzdG10KTtcbiAgICB9XG4gICAgcHJvcHMuZGF0YVByb2Nlc3NpbmdNY3BSZXBvc2l0b3J5LmdyYW50UHVsbChkYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVSb2xlKTtcblxuICAgIC8vIEF0aGVuYSBwZXJtaXNzaW9uc1xuICAgIGRhdGFQcm9jZXNzaW5nTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYXRoZW5hOlN0YXJ0UXVlcnlFeGVjdXRpb24nLFxuICAgICAgICAnYXRoZW5hOkdldFF1ZXJ5RXhlY3V0aW9uJyxcbiAgICAgICAgJ2F0aGVuYTpHZXRRdWVyeVJlc3VsdHMnLFxuICAgICAgICAnYXRoZW5hOlN0b3BRdWVyeUV4ZWN1dGlvbicsXG4gICAgICAgICdhdGhlbmE6TGlzdFF1ZXJ5RXhlY3V0aW9ucycsXG4gICAgICAgICdhdGhlbmE6R2V0V29ya0dyb3VwJyxcbiAgICAgICAgJ2F0aGVuYTpMaXN0V29ya0dyb3VwcycsXG4gICAgICAgICdhdGhlbmE6TGlzdE5hbWVkUXVlcmllcycsXG4gICAgICAgICdhdGhlbmE6R2V0TmFtZWRRdWVyeScsXG4gICAgICAgICdhdGhlbmE6TGlzdERhdGFiYXNlcycsXG4gICAgICAgICdhdGhlbmE6TGlzdFRhYmxlTWV0YWRhdGEnLFxuICAgICAgICAnYXRoZW5hOkdldFRhYmxlTWV0YWRhdGEnLFxuICAgICAgICAnYXRoZW5hOkdldERhdGFiYXNlJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEdsdWUgQ2F0YWxvZyBwZXJtaXNzaW9uc1xuICAgIGRhdGFQcm9jZXNzaW5nTWNwUnVudGltZVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZ2x1ZTpHZXREYXRhYmFzZScsXG4gICAgICAgICdnbHVlOkdldERhdGFiYXNlcycsXG4gICAgICAgICdnbHVlOkdldFRhYmxlJyxcbiAgICAgICAgJ2dsdWU6R2V0VGFibGVzJyxcbiAgICAgICAgJ2dsdWU6R2V0UGFydGl0aW9uJyxcbiAgICAgICAgJ2dsdWU6R2V0UGFydGl0aW9ucycsXG4gICAgICAgICdnbHVlOlNlYXJjaFRhYmxlcycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBTMyBwZXJtaXNzaW9ucyBmb3IgQ1VSIGJ1Y2tldCBhbmQgQXRoZW5hIHJlc3VsdHNcbiAgICBjb25zdCBzM1Jlc291cmNlcyA9IFsnYXJuOmF3czpzMzo6OionXTtcbiAgICBjb25zdCBzM09iamVjdFJlc291cmNlcyA9IFsnYXJuOmF3czpzMzo6OiovKiddO1xuXG4gICAgZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzMzpHZXRPYmplY3QnLFxuICAgICAgICAnczM6TGlzdEJ1Y2tldCcsXG4gICAgICAgICdzMzpHZXRCdWNrZXRMb2NhdGlvbicsXG4gICAgICAgICdzMzpQdXRPYmplY3QnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWy4uLnMzUmVzb3VyY2VzLCAuLi5zM09iamVjdFJlc291cmNlc10sXG4gICAgfSkpO1xuXG4gICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciB0aGUgcnVudGltZVxuICAgIGNvbnN0IGRhdGFQcm9jZXNzaW5nRW52VmFyczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSA9IHtcbiAgICAgIEFXU19SRUdJT046IHRoaXMucmVnaW9uLFxuICAgICAgREVQTE9ZTUVOVF9USU1FU1RBTVA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIEFUSEVOQV9EQVRBQkFTRTogcHJvcHMuYXRoZW5hRGF0YWJhc2UsXG4gICAgICBBVEhFTkFfVEFCTEU6IHByb3BzLmF0aGVuYVRhYmxlLFxuICAgICAgQVRIRU5BX09VVFBVVF9CVUNLRVQ6IHByb3BzLmF0aGVuYU91dHB1dEJ1Y2tldCxcbiAgICAgIENVUl9TM19CVUNLRVQ6IHByb3BzLmN1clMzQnVja2V0LFxuICAgICAgQ1VSX1MzX1BSRUZJWDogcHJvcHMuY3VyUzNQcmVmaXgsXG4gICAgfTtcblxuICAgIGNvbnN0IGNmbkRhdGFQcm9jZXNzaW5nTWNwUnVudGltZSA9IG5ldyBjZGsuQ2ZuUmVzb3VyY2UodGhpcywgJ0RhdGFQcm9jZXNzaW5nTWNwUnVudGltZScsIHtcbiAgICAgIHR5cGU6ICdBV1M6OkJlZHJvY2tBZ2VudENvcmU6OlJ1bnRpbWUnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBBZ2VudFJ1bnRpbWVOYW1lOiAnZmlub3BzX2RhdGFwcm9jZXNzaW5nX21jcF9qd3RfdjEnLFxuICAgICAgICBEZXNjcmlwdGlvbjogJ0FXUyBMYWJzIERhdGEgUHJvY2Vzc2luZyBNQ1AgU2VydmVyIFJ1bnRpbWUgKEF0aGVuYS9HbHVlKSB3aXRoIEpXVCBhdXRob3JpemF0aW9uJyxcbiAgICAgICAgUm9sZUFybjogZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lUm9sZS5yb2xlQXJuLFxuICAgICAgICBBdXRob3JpemVyQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIEN1c3RvbUpXVEF1dGhvcml6ZXI6IHtcbiAgICAgICAgICAgIEFsbG93ZWRDbGllbnRzOiBbcHJvcHMubTJtQ2xpZW50SWRdLFxuICAgICAgICAgICAgRGlzY292ZXJ5VXJsOiBgaHR0cHM6Ly9jb2duaXRvLWlkcC4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7cHJvcHMudXNlclBvb2xJZH0vLndlbGwta25vd24vb3BlbmlkLWNvbmZpZ3VyYXRpb25gLFxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgQWdlbnRSdW50aW1lQXJ0aWZhY3Q6IHtcbiAgICAgICAgICBDb250YWluZXJDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJVcmk6IGAke3Byb3BzLmRhdGFQcm9jZXNzaW5nTWNwUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfTpsYXRlc3RgXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBOZXR3b3JrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIE5ldHdvcmtNb2RlOiAnUFVCTElDJ1xuICAgICAgICB9LFxuICAgICAgICBFbnZpcm9ubWVudFZhcmlhYmxlczogZGF0YVByb2Nlc3NpbmdFbnZWYXJzLFxuICAgICAgICBQcm90b2NvbENvbmZpZ3VyYXRpb246ICdNQ1AnLFxuICAgICAgICBMaWZlY3ljbGVDb25maWd1cmF0aW9uOiB7fSxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNmbkRhdGFQcm9jZXNzaW5nTWNwUnVudGltZS5ub2RlLmFkZERlcGVuZGVuY3koZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lUm9sZSk7XG5cbiAgICB0aGlzLmRhdGFQcm9jZXNzaW5nTWNwUnVudGltZUFybiA9IGNmbkRhdGFQcm9jZXNzaW5nTWNwUnVudGltZS5nZXRBdHQoJ0FnZW50UnVudGltZUFybicpLnRvU3RyaW5nKCk7XG4gICAgY29uc3QgZW5jb2RlZERhdGFQcm9jZXNzaW5nQXJuID0gY2RrLkZuLmpvaW4oJycsIFtcbiAgICAgIGNkay5Gbi5zZWxlY3QoMCwgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5kYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCgxLCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmRhdGFQcm9jZXNzaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uc2VsZWN0KDIsIGNkay5Gbi5zcGxpdCgnOicsIHRoaXMuZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lQXJuKSksXG4gICAgICAnJTNBJyxcbiAgICAgIGNkay5Gbi5zZWxlY3QoMywgY2RrLkZuLnNwbGl0KCc6JywgdGhpcy5kYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVBcm4pKSxcbiAgICAgICclM0EnLFxuICAgICAgY2RrLkZuLnNlbGVjdCg0LCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmRhdGFQcm9jZXNzaW5nTWNwUnVudGltZUFybikpLFxuICAgICAgJyUzQScsXG4gICAgICBjZGsuRm4uam9pbignJTJGJywgY2RrLkZuLnNwbGl0KCcvJywgY2RrLkZuLnNlbGVjdCg1LCBjZGsuRm4uc3BsaXQoJzonLCB0aGlzLmRhdGFQcm9jZXNzaW5nTWNwUnVudGltZUFybikpKSksXG4gICAgXSk7XG4gICAgdGhpcy5kYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVFbmRwb2ludCA9IGBodHRwczovL2JlZHJvY2stYWdlbnRjb3JlLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb20vcnVudGltZXMvJHtlbmNvZGVkRGF0YVByb2Nlc3NpbmdBcm59L2ludm9jYXRpb25zP3F1YWxpZmllcj1ERUZBVUxUYDtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JpbGxpbmdNY3BSdW50aW1lQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuYmlsbGluZ01jcFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0JpbGxpbmcgTUNQIFNlcnZlciBSdW50aW1lIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQmlsbGluZ01jcFJ1bnRpbWVBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JpbGxpbmdNY3BSdW50aW1lRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5iaWxsaW5nTWNwUnVudGltZUVuZHBvaW50LFxuICAgICAgZGVzY3JpcHRpb246ICdCaWxsaW5nIE1DUCBTZXJ2ZXIgUnVudGltZSBFbmRwb2ludCcsXG4gICAgICBleHBvcnROYW1lOiBgJHt0aGlzLnN0YWNrTmFtZX0tQmlsbGluZ01jcFJ1bnRpbWVFbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUHJpY2luZ01jcFJ1bnRpbWVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5wcmljaW5nTWNwUnVudGltZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHJpY2luZyBNQ1AgU2VydmVyIFJ1bnRpbWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1QcmljaW5nTWNwUnVudGltZUFybmAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUHJpY2luZ01jcFJ1bnRpbWVFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnByaWNpbmdNY3BSdW50aW1lRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ByaWNpbmcgTUNQIFNlcnZlciBSdW50aW1lIEVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1QcmljaW5nTWNwUnVudGltZUVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0RhdGEgUHJvY2Vzc2luZyBNQ1AgU2VydmVyIFJ1bnRpbWUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1EYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RhdGFQcm9jZXNzaW5nTWNwUnVudGltZUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMuZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0RhdGEgUHJvY2Vzc2luZyBNQ1AgU2VydmVyIFJ1bnRpbWUgRW5kcG9pbnQnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LURhdGFQcm9jZXNzaW5nTWNwUnVudGltZUVuZHBvaW50YCxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDREstTmFnIFN1cHByZXNzaW9uc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhiaWxsaW5nTWNwUnVudGltZVJvbGUsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1dpbGRjYXJkIHBlcm1pc3Npb25zIHJlcXVpcmVkIGZvciBDb3N0IEV4cGxvcmVyIEFQSXMgKGFjY291bnQtbGV2ZWwgc2VydmljZXMpLCBFQ1IgYXV0aCB0b2tlbiwgQ2xvdWRXYXRjaCwgWC1SYXknLFxuICAgICAgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhwcmljaW5nTWNwUnVudGltZVJvbGUsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1dpbGRjYXJkIHBlcm1pc3Npb25zIHJlcXVpcmVkIGZvciBBV1MgUHJpY2luZyBBUEkgKGdsb2JhbCBzZXJ2aWNlKSwgRUNSIGF1dGggdG9rZW4sIENsb3VkV2F0Y2gsIFgtUmF5JyxcbiAgICAgIH0sXG4gICAgXSwgdHJ1ZSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lUm9sZSwgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgcmVhc29uOiAnV2lsZGNhcmQgcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIEF0aGVuYSwgR2x1ZSBDYXRhbG9nLCBTMyAoQ1VSIGRhdGEgKyBxdWVyeSByZXN1bHRzKSwgRUNSIGF1dGggdG9rZW4sIENsb3VkV2F0Y2gnLFxuICAgICAgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyh0aGlzLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUwxJyxcbiAgICAgICAgcmVhc29uOiAnUHl0aG9uIDMuMTQgaXMgdGhlIGxhdGVzdCBMYW1iZGEgcnVudGltZSB2ZXJzaW9uIGF2YWlsYWJsZScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgcmVhc29uOiAnQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlIG1hbmFnZWQgcG9saWN5IGlzIEFXUyBiZXN0IHByYWN0aWNlIGZvciBMYW1iZGEgZnVuY3Rpb25zJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdXaWxkY2FyZCBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgY3VzdG9tIHJlc291cmNlIExhbWJkYSBmdW5jdGlvbnMnLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxufVxuIl19