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
exports.AgentCoreGatewayStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const cr = __importStar(require("aws-cdk-lib/custom-resources"));
const cdk_nag_1 = require("cdk-nag");
class AgentCoreGatewayStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========================================
        // Retrieve AuthStack M2M client secret
        // ========================================
        const describeM2MClient = new cr.AwsCustomResource(this, 'DescribeM2MClient', {
            onCreate: {
                service: 'CognitoIdentityServiceProvider',
                action: 'describeUserPoolClient',
                parameters: {
                    UserPoolId: props.authUserPoolId,
                    ClientId: props.authM2mClientId,
                },
                physicalResourceId: cr.PhysicalResourceId.of('m2m-client-secret'),
            },
            policy: cr.AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: ['cognito-idp:DescribeUserPoolClient'],
                    resources: [props.authUserPoolArn],
                }),
            ]),
        });
        const m2mClientSecret = describeM2MClient.getResponseField('UserPoolClient.ClientSecret');
        // ========================================
        // Gateway Token Exchange Policy (managed policy, wildcard)
        // ========================================
        const tokenExchangePolicy = new iam.ManagedPolicy(this, 'GatewayTokenExchangePolicy', {
            statements: [
                new iam.PolicyStatement({
                    sid: 'AgentCoreIdentityTokenExchange',
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'bedrock-agentcore:GetWorkloadAccessToken',
                        'bedrock-agentcore:GetResourceOauth2Token',
                    ],
                    resources: ['*'],
                }),
            ],
        });
        // ========================================
        // Gateway Service Role
        // ========================================
        const gatewayRole = new iam.Role(this, 'GatewayServiceRole', {
            description: 'Service role for FinOps AgentCore Gateway',
            assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
            managedPolicies: [tokenExchangePolicy],
        });
        // ========================================
        // OAuth Provider (Lambda custom resource)
        // Uses AuthStack's Cognito for outbound auth to MCP runtimes
        // ========================================
        const oauthProviderFn = new lambda.Function(this, 'OAuthProviderFunction', {
            runtime: lambda.Runtime.PYTHON_3_14,
            handler: 'index.handler',
            timeout: cdk.Duration.minutes(2),
            code: lambda.Code.fromInline(`
import json
import logging
import urllib.request
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def send_cfn_response(event, status, data=None, reason=None, physical_id=None):
    response_body = json.dumps({
        'Status': status,
        'Reason': reason or 'See CloudWatch Logs',
        'PhysicalResourceId': physical_id or event.get('PhysicalResourceId', event['RequestId']),
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': data or {},
    })
    response_url = event['ResponseURL']
    if not response_url.startswith('https://'):
        raise ValueError(f'Invalid response URL scheme')
    req = urllib.request.Request(
        response_url,
        data=response_body.encode('utf-8'),
        headers={'Content-Type': ''},
        method='PUT',
    )
    urllib.request.urlopen(req)

def handler(event, context):
    logger.info(f'Event: {json.dumps(event)}')
    request_type = event['RequestType']
    props = event['ResourceProperties']
    provider_name = props.get('ProviderName', '')
    region = props.get('Region', 'us-east-1')
    client = boto3.client('bedrock-agentcore-control', region_name=region)

    if request_type == 'Delete':
        try:
            client.delete_oauth2_credential_provider(name=provider_name)
            send_cfn_response(event, 'SUCCESS')
        except Exception:
            send_cfn_response(event, 'SUCCESS')
        return

    try:
        response = client.create_oauth2_credential_provider(
            name=provider_name,
            credentialProviderVendor='CustomOauth2',
            oauth2ProviderConfigInput={
                'customOauth2ProviderConfig': {
                    'oauthDiscovery': {
                        'discoveryUrl': props.get('DiscoveryUrl', ''),
                    },
                    'clientId': props.get('ClientId', ''),
                    'clientSecret': props.get('ClientSecret', ''),
                },
            },
        )
        provider_arn = response.get('credentialProviderArn', '')
        secret_arn = response.get('clientSecretArn', {}).get('secretArn', '')
        logger.info(f'Created provider: {provider_arn}')
        send_cfn_response(event, 'SUCCESS', data={
            'ProviderArn': provider_arn,
            'SecretArn': secret_arn,
        }, physical_id=provider_name)
    except Exception as e:
        logger.error(f'Create failed: {e}')
        send_cfn_response(event, 'FAILED', reason=str(e))
`),
        });
        oauthProviderFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:CreateOauth2CredentialProvider',
                'bedrock-agentcore:DeleteOauth2CredentialProvider',
                'bedrock-agentcore:GetOauth2CredentialProvider',
                'bedrock-agentcore:CreateTokenVault',
                'bedrock-agentcore:GetTokenVault',
            ],
            resources: ['*'],
        }));
        oauthProviderFn.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'secretsmanager:CreateSecret',
                'secretsmanager:DeleteSecret',
                'secretsmanager:PutSecretValue',
                'secretsmanager:TagResource',
            ],
            resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity*`,
            ],
        }));
        const oauthProvider = new cdk.CustomResource(this, 'OAuthProvider', {
            serviceToken: oauthProviderFn.functionArn,
            properties: {
                ProviderName: `${this.stackName}-oauth-provider`,
                DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.authUserPoolId}/.well-known/openid-configuration`,
                ClientId: props.authM2mClientId,
                ClientSecret: m2mClientSecret,
                Region: this.region,
            },
        });
        const oauthProviderArn = oauthProvider.getAttString('ProviderArn');
        const oauthSecretArn = oauthProvider.getAttString('SecretArn');
        // ========================================
        // Default Policy on Gateway Role (scoped to OAuth provider resources)
        // ========================================
        gatewayRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock-agentcore:GetResourceOauth2Token',
                'bedrock-agentcore:GetWorkloadAccessToken',
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
            ],
            resources: [oauthProviderArn, oauthSecretArn],
        }));
        // ========================================
        // Gateway (AWS_IAM auth — Main Runtime calls via InvokeGateway API)
        // ========================================
        const gateway = new cdk.CfnResource(this, 'McpGateway', {
            type: 'AWS::BedrockAgentCore::Gateway',
            properties: {
                Name: 'finops-gateway',
                Description: 'FinOps Gateway for billing and pricing MCP tools (IAM auth)',
                ProtocolType: 'MCP',
                AuthorizerType: 'AWS_IAM',
                ProtocolConfiguration: {
                    Mcp: {
                        Instructions: 'FinOps gateway for billing and pricing MCP tools',
                        SearchType: 'SEMANTIC',
                        SupportedVersions: ['2025-03-26'],
                    },
                },
                RoleArn: gatewayRole.roleArn,
            },
        });
        gateway.node.addDependency(oauthProvider);
        this.gatewayArn = gateway.getAtt('GatewayArn').toString();
        const gatewayId = gateway.getAtt('GatewayIdentifier').toString();
        this.gatewayUrl = gateway.getAtt('GatewayUrl').toString();
        // ========================================
        // Gateway Targets (MCP Server endpoints)
        // ========================================
        const billingTarget = new cdk.CfnResource(this, 'BillingMcpTarget', {
            type: 'AWS::BedrockAgentCore::GatewayTarget',
            properties: {
                GatewayIdentifier: gatewayId,
                Name: 'billingMcp',
                Description: 'AWS Labs Billing MCP Server on AgentCore Runtime',
                TargetConfiguration: {
                    Mcp: { McpServer: { Endpoint: props.billingMcpRuntimeEndpoint } },
                },
                CredentialProviderConfigurations: [{
                        CredentialProviderType: 'OAUTH',
                        CredentialProvider: {
                            OauthCredentialProvider: {
                                ProviderArn: oauthProviderArn,
                                Scopes: ['mcp-runtime-server/invoke'],
                            },
                        },
                    }],
            },
        });
        billingTarget.node.addDependency(gateway);
        const pricingTarget = new cdk.CfnResource(this, 'PricingMcpTarget', {
            type: 'AWS::BedrockAgentCore::GatewayTarget',
            properties: {
                GatewayIdentifier: gatewayId,
                Name: 'pricingMcp',
                Description: 'AWS Labs Pricing MCP Server on AgentCore Runtime',
                TargetConfiguration: {
                    Mcp: { McpServer: { Endpoint: props.pricingMcpRuntimeEndpoint } },
                },
                CredentialProviderConfigurations: [{
                        CredentialProviderType: 'OAUTH',
                        CredentialProvider: {
                            OauthCredentialProvider: {
                                ProviderArn: oauthProviderArn,
                                Scopes: ['mcp-runtime-server/invoke'],
                            },
                        },
                    }],
            },
        });
        pricingTarget.node.addDependency(gateway);
        const dataProcessingTarget = new cdk.CfnResource(this, 'DataProcessingMcpTarget', {
            type: 'AWS::BedrockAgentCore::GatewayTarget',
            properties: {
                GatewayIdentifier: gatewayId,
                Name: 'dataProcessingMcp',
                Description: 'AWS Labs Data Processing MCP Server (Athena/Glue) on AgentCore Runtime',
                TargetConfiguration: {
                    Mcp: { McpServer: { Endpoint: props.dataProcessingMcpRuntimeEndpoint } },
                },
                CredentialProviderConfigurations: [{
                        CredentialProviderType: 'OAUTH',
                        CredentialProvider: {
                            OauthCredentialProvider: {
                                ProviderArn: oauthProviderArn,
                                Scopes: ['mcp-runtime-server/invoke'],
                            },
                        },
                    }],
            },
        });
        dataProcessingTarget.node.addDependency(gateway);
        // ========================================
        // Outputs
        // ========================================
        new cdk.CfnOutput(this, 'GatewayArn', {
            value: this.gatewayArn,
            description: 'AgentCore Gateway ARN',
            exportName: `${this.stackName}-GatewayArn`,
        });
        new cdk.CfnOutput(this, 'GatewayUrl', {
            value: this.gatewayUrl,
            description: 'AgentCore Gateway URL',
            exportName: `${this.stackName}-GatewayUrl`,
        });
        // ========================================
        // CDK-Nag Suppressions
        // ========================================
        cdk_nag_1.NagSuppressions.addResourceSuppressions(gatewayRole, [
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore Identity token exchange and OAuth provider management.' },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(oauthProviderFn, [
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard required for AgentCore Identity token vault creation and bedrock-agentcore-identity secrets namespace.' },
        ], true);
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is AWS best practice.', appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'] },
            { id: 'AwsSolutions-IAM5', reason: 'Wildcard for AgentCore Identity token exchange, OAuth credential provider management.', appliesTo: ['Resource::*'] },
            { id: 'AwsSolutions-L1', reason: 'Lambda runtime version managed by CDK.' },
        ]);
    }
}
exports.AgentCoreGatewayStack = AgentCoreGatewayStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ2F0ZXdheS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImdhdGV3YXktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHlEQUEyQztBQUMzQywrREFBaUQ7QUFDakQsaUVBQW1EO0FBRW5ELHFDQUEwQztBQWdCMUMsTUFBYSxxQkFBc0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUlsRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWlDO1FBQ3pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDJDQUEyQztRQUMzQyx1Q0FBdUM7UUFDdkMsMkNBQTJDO1FBRTNDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxFQUFFLENBQUMsaUJBQWlCLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzVFLFFBQVEsRUFBRTtnQkFDUixPQUFPLEVBQUUsZ0NBQWdDO2dCQUN6QyxNQUFNLEVBQUUsd0JBQXdCO2dCQUNoQyxVQUFVLEVBQUU7b0JBQ1YsVUFBVSxFQUFFLEtBQUssQ0FBQyxjQUFjO29CQUNoQyxRQUFRLEVBQUUsS0FBSyxDQUFDLGVBQWU7aUJBQ2hDO2dCQUNELGtCQUFrQixFQUFFLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsbUJBQW1CLENBQUM7YUFDbEU7WUFDRCxNQUFNLEVBQUUsRUFBRSxDQUFDLHVCQUF1QixDQUFDLGNBQWMsQ0FBQztnQkFDaEQsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO29CQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO29CQUN4QixPQUFPLEVBQUUsQ0FBQyxvQ0FBb0MsQ0FBQztvQkFDL0MsU0FBUyxFQUFFLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQztpQkFDbkMsQ0FBQzthQUNILENBQUM7U0FDSCxDQUFDLENBQUM7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Q0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBdlVELHNEQXVVQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBjciBmcm9tICdhd3MtY2RrLWxpYi9jdXN0b20tcmVzb3VyY2VzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQWdlbnRDb3JlR2F0ZXdheVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIC8vIE1DUCBSdW50aW1lIGVuZHBvaW50cyBmcm9tIE1DUFJ1bnRpbWVTdGFja1xuICBiaWxsaW5nTWNwUnVudGltZUFybjogc3RyaW5nO1xuICBiaWxsaW5nTWNwUnVudGltZUVuZHBvaW50OiBzdHJpbmc7XG4gIHByaWNpbmdNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIHByaWNpbmdNY3BSdW50aW1lRW5kcG9pbnQ6IHN0cmluZztcbiAgZGF0YVByb2Nlc3NpbmdNY3BSdW50aW1lQXJuOiBzdHJpbmc7XG4gIGRhdGFQcm9jZXNzaW5nTWNwUnVudGltZUVuZHBvaW50OiBzdHJpbmc7XG4gIC8vIEF1dGhTdGFjayBDb2duaXRvIC0gdXNlZCBmb3IgT0F1dGggcHJvdmlkZXIgKG91dGJvdW5kIGF1dGggdG8gcnVudGltZXMpXG4gIGF1dGhVc2VyUG9vbElkOiBzdHJpbmc7XG4gIGF1dGhVc2VyUG9vbEFybjogc3RyaW5nO1xuICBhdXRoTTJtQ2xpZW50SWQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIEFnZW50Q29yZUdhdGV3YXlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBnYXRld2F5QXJuOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBnYXRld2F5VXJsOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEFnZW50Q29yZUdhdGV3YXlTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUmV0cmlldmUgQXV0aFN0YWNrIE0yTSBjbGllbnQgc2VjcmV0XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgZGVzY3JpYmVNMk1DbGllbnQgPSBuZXcgY3IuQXdzQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0Rlc2NyaWJlTTJNQ2xpZW50Jywge1xuICAgICAgb25DcmVhdGU6IHtcbiAgICAgICAgc2VydmljZTogJ0NvZ25pdG9JZGVudGl0eVNlcnZpY2VQcm92aWRlcicsXG4gICAgICAgIGFjdGlvbjogJ2Rlc2NyaWJlVXNlclBvb2xDbGllbnQnLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgVXNlclBvb2xJZDogcHJvcHMuYXV0aFVzZXJQb29sSWQsXG4gICAgICAgICAgQ2xpZW50SWQ6IHByb3BzLmF1dGhNMm1DbGllbnRJZCxcbiAgICAgICAgfSxcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBjci5QaHlzaWNhbFJlc291cmNlSWQub2YoJ20ybS1jbGllbnQtc2VjcmV0JyksXG4gICAgICB9LFxuICAgICAgcG9saWN5OiBjci5Bd3NDdXN0b21SZXNvdXJjZVBvbGljeS5mcm9tU3RhdGVtZW50cyhbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgYWN0aW9uczogWydjb2duaXRvLWlkcDpEZXNjcmliZVVzZXJQb29sQ2xpZW50J10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbcHJvcHMuYXV0aFVzZXJQb29sQXJuXSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IG0ybUNsaWVudFNlY3JldCA9IGRlc2NyaWJlTTJNQ2xpZW50LmdldFJlc3BvbnNlRmllbGQoJ1VzZXJQb29sQ2xpZW50LkNsaWVudFNlY3JldCcpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgVG9rZW4gRXhjaGFuZ2UgUG9saWN5IChtYW5hZ2VkIHBvbGljeSwgd2lsZGNhcmQpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgdG9rZW5FeGNoYW5nZVBvbGljeSA9IG5ldyBpYW0uTWFuYWdlZFBvbGljeSh0aGlzLCAnR2F0ZXdheVRva2VuRXhjaGFuZ2VQb2xpY3knLCB7XG4gICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBzaWQ6ICdBZ2VudENvcmVJZGVudGl0eVRva2VuRXhjaGFuZ2UnLFxuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6R2V0V29ya2xvYWRBY2Nlc3NUb2tlbicsXG4gICAgICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6R2V0UmVzb3VyY2VPYXV0aDJUb2tlbicsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gR2F0ZXdheSBTZXJ2aWNlIFJvbGVcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBnYXRld2F5Um9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnR2F0ZXdheVNlcnZpY2VSb2xlJywge1xuICAgICAgZGVzY3JpcHRpb246ICdTZXJ2aWNlIHJvbGUgZm9yIEZpbk9wcyBBZ2VudENvcmUgR2F0ZXdheScsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay1hZ2VudGNvcmUuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbdG9rZW5FeGNoYW5nZVBvbGljeV0sXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gT0F1dGggUHJvdmlkZXIgKExhbWJkYSBjdXN0b20gcmVzb3VyY2UpXG4gICAgLy8gVXNlcyBBdXRoU3RhY2sncyBDb2duaXRvIGZvciBvdXRib3VuZCBhdXRoIHRvIE1DUCBydW50aW1lc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IG9hdXRoUHJvdmlkZXJGbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ09BdXRoUHJvdmlkZXJGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzE0LFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMiksXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcbmltcG9ydCBqc29uXG5pbXBvcnQgbG9nZ2luZ1xuaW1wb3J0IHVybGxpYi5yZXF1ZXN0XG5pbXBvcnQgYm90bzNcblxubG9nZ2VyID0gbG9nZ2luZy5nZXRMb2dnZXIoKVxubG9nZ2VyLnNldExldmVsKGxvZ2dpbmcuSU5GTylcblxuZGVmIHNlbmRfY2ZuX3Jlc3BvbnNlKGV2ZW50LCBzdGF0dXMsIGRhdGE9Tm9uZSwgcmVhc29uPU5vbmUsIHBoeXNpY2FsX2lkPU5vbmUpOlxuICAgIHJlc3BvbnNlX2JvZHkgPSBqc29uLmR1bXBzKHtcbiAgICAgICAgJ1N0YXR1cyc6IHN0YXR1cyxcbiAgICAgICAgJ1JlYXNvbic6IHJlYXNvbiBvciAnU2VlIENsb3VkV2F0Y2ggTG9ncycsXG4gICAgICAgICdQaHlzaWNhbFJlc291cmNlSWQnOiBwaHlzaWNhbF9pZCBvciBldmVudC5nZXQoJ1BoeXNpY2FsUmVzb3VyY2VJZCcsIGV2ZW50WydSZXF1ZXN0SWQnXSksXG4gICAgICAgICdTdGFja0lkJzogZXZlbnRbJ1N0YWNrSWQnXSxcbiAgICAgICAgJ1JlcXVlc3RJZCc6IGV2ZW50WydSZXF1ZXN0SWQnXSxcbiAgICAgICAgJ0xvZ2ljYWxSZXNvdXJjZUlkJzogZXZlbnRbJ0xvZ2ljYWxSZXNvdXJjZUlkJ10sXG4gICAgICAgICdEYXRhJzogZGF0YSBvciB7fSxcbiAgICB9KVxuICAgIHJlc3BvbnNlX3VybCA9IGV2ZW50WydSZXNwb25zZVVSTCddXG4gICAgaWYgbm90IHJlc3BvbnNlX3VybC5zdGFydHN3aXRoKCdodHRwczovLycpOlxuICAgICAgICByYWlzZSBWYWx1ZUVycm9yKGYnSW52YWxpZCByZXNwb25zZSBVUkwgc2NoZW1lJylcbiAgICByZXEgPSB1cmxsaWIucmVxdWVzdC5SZXF1ZXN0KFxuICAgICAgICByZXNwb25zZV91cmwsXG4gICAgICAgIGRhdGE9cmVzcG9uc2VfYm9keS5lbmNvZGUoJ3V0Zi04JyksXG4gICAgICAgIGhlYWRlcnM9eydDb250ZW50LVR5cGUnOiAnJ30sXG4gICAgICAgIG1ldGhvZD0nUFVUJyxcbiAgICApXG4gICAgdXJsbGliLnJlcXVlc3QudXJsb3BlbihyZXEpXG5cbmRlZiBoYW5kbGVyKGV2ZW50LCBjb250ZXh0KTpcbiAgICBsb2dnZXIuaW5mbyhmJ0V2ZW50OiB7anNvbi5kdW1wcyhldmVudCl9JylcbiAgICByZXF1ZXN0X3R5cGUgPSBldmVudFsnUmVxdWVzdFR5cGUnXVxuICAgIHByb3BzID0gZXZlbnRbJ1Jlc291cmNlUHJvcGVydGllcyddXG4gICAgcHJvdmlkZXJfbmFtZSA9IHByb3BzLmdldCgnUHJvdmlkZXJOYW1lJywgJycpXG4gICAgcmVnaW9uID0gcHJvcHMuZ2V0KCdSZWdpb24nLCAndXMtZWFzdC0xJylcbiAgICBjbGllbnQgPSBib3RvMy5jbGllbnQoJ2JlZHJvY2stYWdlbnRjb3JlLWNvbnRyb2wnLCByZWdpb25fbmFtZT1yZWdpb24pXG5cbiAgICBpZiByZXF1ZXN0X3R5cGUgPT0gJ0RlbGV0ZSc6XG4gICAgICAgIHRyeTpcbiAgICAgICAgICAgIGNsaWVudC5kZWxldGVfb2F1dGgyX2NyZWRlbnRpYWxfcHJvdmlkZXIobmFtZT1wcm92aWRlcl9uYW1lKVxuICAgICAgICAgICAgc2VuZF9jZm5fcmVzcG9uc2UoZXZlbnQsICdTVUNDRVNTJylcbiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjpcbiAgICAgICAgICAgIHNlbmRfY2ZuX3Jlc3BvbnNlKGV2ZW50LCAnU1VDQ0VTUycpXG4gICAgICAgIHJldHVyblxuXG4gICAgdHJ5OlxuICAgICAgICByZXNwb25zZSA9IGNsaWVudC5jcmVhdGVfb2F1dGgyX2NyZWRlbnRpYWxfcHJvdmlkZXIoXG4gICAgICAgICAgICBuYW1lPXByb3ZpZGVyX25hbWUsXG4gICAgICAgICAgICBjcmVkZW50aWFsUHJvdmlkZXJWZW5kb3I9J0N1c3RvbU9hdXRoMicsXG4gICAgICAgICAgICBvYXV0aDJQcm92aWRlckNvbmZpZ0lucHV0PXtcbiAgICAgICAgICAgICAgICAnY3VzdG9tT2F1dGgyUHJvdmlkZXJDb25maWcnOiB7XG4gICAgICAgICAgICAgICAgICAgICdvYXV0aERpc2NvdmVyeSc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdkaXNjb3ZlcnlVcmwnOiBwcm9wcy5nZXQoJ0Rpc2NvdmVyeVVybCcsICcnKSxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgJ2NsaWVudElkJzogcHJvcHMuZ2V0KCdDbGllbnRJZCcsICcnKSxcbiAgICAgICAgICAgICAgICAgICAgJ2NsaWVudFNlY3JldCc6IHByb3BzLmdldCgnQ2xpZW50U2VjcmV0JywgJycpLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgICAgIHByb3ZpZGVyX2FybiA9IHJlc3BvbnNlLmdldCgnY3JlZGVudGlhbFByb3ZpZGVyQXJuJywgJycpXG4gICAgICAgIHNlY3JldF9hcm4gPSByZXNwb25zZS5nZXQoJ2NsaWVudFNlY3JldEFybicsIHt9KS5nZXQoJ3NlY3JldEFybicsICcnKVxuICAgICAgICBsb2dnZXIuaW5mbyhmJ0NyZWF0ZWQgcHJvdmlkZXI6IHtwcm92aWRlcl9hcm59JylcbiAgICAgICAgc2VuZF9jZm5fcmVzcG9uc2UoZXZlbnQsICdTVUNDRVNTJywgZGF0YT17XG4gICAgICAgICAgICAnUHJvdmlkZXJBcm4nOiBwcm92aWRlcl9hcm4sXG4gICAgICAgICAgICAnU2VjcmV0QXJuJzogc2VjcmV0X2FybixcbiAgICAgICAgfSwgcGh5c2ljYWxfaWQ9cHJvdmlkZXJfbmFtZSlcbiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6XG4gICAgICAgIGxvZ2dlci5lcnJvcihmJ0NyZWF0ZSBmYWlsZWQ6IHtlfScpXG4gICAgICAgIHNlbmRfY2ZuX3Jlc3BvbnNlKGV2ZW50LCAnRkFJTEVEJywgcmVhc29uPXN0cihlKSlcbmApLFxuICAgIH0pO1xuXG4gICAgb2F1dGhQcm92aWRlckZuLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpDcmVhdGVPYXV0aDJDcmVkZW50aWFsUHJvdmlkZXInLFxuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6RGVsZXRlT2F1dGgyQ3JlZGVudGlhbFByb3ZpZGVyJyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldE9hdXRoMkNyZWRlbnRpYWxQcm92aWRlcicsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpDcmVhdGVUb2tlblZhdWx0JyxcbiAgICAgICAgJ2JlZHJvY2stYWdlbnRjb3JlOkdldFRva2VuVmF1bHQnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgb2F1dGhQcm92aWRlckZuLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzZWNyZXRzbWFuYWdlcjpDcmVhdGVTZWNyZXQnLFxuICAgICAgICAnc2VjcmV0c21hbmFnZXI6RGVsZXRlU2VjcmV0JyxcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOlB1dFNlY3JldFZhbHVlJyxcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOlRhZ1Jlc291cmNlJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6c2VjcmV0c21hbmFnZXI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnNlY3JldDpiZWRyb2NrLWFnZW50Y29yZS1pZGVudGl0eSpgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICBjb25zdCBvYXV0aFByb3ZpZGVyID0gbmV3IGNkay5DdXN0b21SZXNvdXJjZSh0aGlzLCAnT0F1dGhQcm92aWRlcicsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogb2F1dGhQcm92aWRlckZuLmZ1bmN0aW9uQXJuLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBQcm92aWRlck5hbWU6IGAke3RoaXMuc3RhY2tOYW1lfS1vYXV0aC1wcm92aWRlcmAsXG4gICAgICAgIERpc2NvdmVyeVVybDogYGh0dHBzOi8vY29nbml0by1pZHAuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3Byb3BzLmF1dGhVc2VyUG9vbElkfS8ud2VsbC1rbm93bi9vcGVuaWQtY29uZmlndXJhdGlvbmAsXG4gICAgICAgIENsaWVudElkOiBwcm9wcy5hdXRoTTJtQ2xpZW50SWQsXG4gICAgICAgIENsaWVudFNlY3JldDogbTJtQ2xpZW50U2VjcmV0LFxuICAgICAgICBSZWdpb246IHRoaXMucmVnaW9uLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IG9hdXRoUHJvdmlkZXJBcm4gPSBvYXV0aFByb3ZpZGVyLmdldEF0dFN0cmluZygnUHJvdmlkZXJBcm4nKTtcbiAgICBjb25zdCBvYXV0aFNlY3JldEFybiA9IG9hdXRoUHJvdmlkZXIuZ2V0QXR0U3RyaW5nKCdTZWNyZXRBcm4nKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBEZWZhdWx0IFBvbGljeSBvbiBHYXRld2F5IFJvbGUgKHNjb3BlZCB0byBPQXV0aCBwcm92aWRlciByZXNvdXJjZXMpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgZ2F0ZXdheVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jay1hZ2VudGNvcmU6R2V0UmVzb3VyY2VPYXV0aDJUb2tlbicsXG4gICAgICAgICdiZWRyb2NrLWFnZW50Y29yZTpHZXRXb3JrbG9hZEFjY2Vzc1Rva2VuJyxcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJyxcbiAgICAgICAgJ3NlY3JldHNtYW5hZ2VyOkRlc2NyaWJlU2VjcmV0JyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtvYXV0aFByb3ZpZGVyQXJuLCBvYXV0aFNlY3JldEFybl0sXG4gICAgfSkpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEdhdGV3YXkgKEFXU19JQU0gYXV0aCDigJQgTWFpbiBSdW50aW1lIGNhbGxzIHZpYSBJbnZva2VHYXRld2F5IEFQSSlcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBnYXRld2F5ID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnTWNwR2F0ZXdheScsIHtcbiAgICAgIHR5cGU6ICdBV1M6OkJlZHJvY2tBZ2VudENvcmU6OkdhdGV3YXknLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBOYW1lOiAnZmlub3BzLWdhdGV3YXknLFxuICAgICAgICBEZXNjcmlwdGlvbjogJ0Zpbk9wcyBHYXRld2F5IGZvciBiaWxsaW5nIGFuZCBwcmljaW5nIE1DUCB0b29scyAoSUFNIGF1dGgpJyxcbiAgICAgICAgUHJvdG9jb2xUeXBlOiAnTUNQJyxcbiAgICAgICAgQXV0aG9yaXplclR5cGU6ICdBV1NfSUFNJyxcbiAgICAgICAgUHJvdG9jb2xDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgTWNwOiB7XG4gICAgICAgICAgICBJbnN0cnVjdGlvbnM6ICdGaW5PcHMgZ2F0ZXdheSBmb3IgYmlsbGluZyBhbmQgcHJpY2luZyBNQ1AgdG9vbHMnLFxuICAgICAgICAgICAgU2VhcmNoVHlwZTogJ1NFTUFOVElDJyxcbiAgICAgICAgICAgIFN1cHBvcnRlZFZlcnNpb25zOiBbJzIwMjUtMDMtMjYnXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBSb2xlQXJuOiBnYXRld2F5Um9sZS5yb2xlQXJuLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBnYXRld2F5Lm5vZGUuYWRkRGVwZW5kZW5jeShvYXV0aFByb3ZpZGVyKTtcblxuICAgIHRoaXMuZ2F0ZXdheUFybiA9IGdhdGV3YXkuZ2V0QXR0KCdHYXRld2F5QXJuJykudG9TdHJpbmcoKTtcbiAgICBjb25zdCBnYXRld2F5SWQgPSBnYXRld2F5LmdldEF0dCgnR2F0ZXdheUlkZW50aWZpZXInKS50b1N0cmluZygpO1xuICAgIHRoaXMuZ2F0ZXdheVVybCA9IGdhdGV3YXkuZ2V0QXR0KCdHYXRld2F5VXJsJykudG9TdHJpbmcoKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBHYXRld2F5IFRhcmdldHMgKE1DUCBTZXJ2ZXIgZW5kcG9pbnRzKVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IGJpbGxpbmdUYXJnZXQgPSBuZXcgY2RrLkNmblJlc291cmNlKHRoaXMsICdCaWxsaW5nTWNwVGFyZ2V0Jywge1xuICAgICAgdHlwZTogJ0FXUzo6QmVkcm9ja0FnZW50Q29yZTo6R2F0ZXdheVRhcmdldCcsXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIEdhdGV3YXlJZGVudGlmaWVyOiBnYXRld2F5SWQsXG4gICAgICAgIE5hbWU6ICdiaWxsaW5nTWNwJyxcbiAgICAgICAgRGVzY3JpcHRpb246ICdBV1MgTGFicyBCaWxsaW5nIE1DUCBTZXJ2ZXIgb24gQWdlbnRDb3JlIFJ1bnRpbWUnLFxuICAgICAgICBUYXJnZXRDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgTWNwOiB7IE1jcFNlcnZlcjogeyBFbmRwb2ludDogcHJvcHMuYmlsbGluZ01jcFJ1bnRpbWVFbmRwb2ludCB9IH0sXG4gICAgICAgIH0sXG4gICAgICAgIENyZWRlbnRpYWxQcm92aWRlckNvbmZpZ3VyYXRpb25zOiBbe1xuICAgICAgICAgIENyZWRlbnRpYWxQcm92aWRlclR5cGU6ICdPQVVUSCcsXG4gICAgICAgICAgQ3JlZGVudGlhbFByb3ZpZGVyOiB7XG4gICAgICAgICAgICBPYXV0aENyZWRlbnRpYWxQcm92aWRlcjoge1xuICAgICAgICAgICAgICBQcm92aWRlckFybjogb2F1dGhQcm92aWRlckFybixcbiAgICAgICAgICAgICAgU2NvcGVzOiBbJ21jcC1ydW50aW1lLXNlcnZlci9pbnZva2UnXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfV0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGJpbGxpbmdUYXJnZXQubm9kZS5hZGREZXBlbmRlbmN5KGdhdGV3YXkpO1xuXG4gICAgY29uc3QgcHJpY2luZ1RhcmdldCA9IG5ldyBjZGsuQ2ZuUmVzb3VyY2UodGhpcywgJ1ByaWNpbmdNY3BUYXJnZXQnLCB7XG4gICAgICB0eXBlOiAnQVdTOjpCZWRyb2NrQWdlbnRDb3JlOjpHYXRld2F5VGFyZ2V0JyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgR2F0ZXdheUlkZW50aWZpZXI6IGdhdGV3YXlJZCxcbiAgICAgICAgTmFtZTogJ3ByaWNpbmdNY3AnLFxuICAgICAgICBEZXNjcmlwdGlvbjogJ0FXUyBMYWJzIFByaWNpbmcgTUNQIFNlcnZlciBvbiBBZ2VudENvcmUgUnVudGltZScsXG4gICAgICAgIFRhcmdldENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBNY3A6IHsgTWNwU2VydmVyOiB7IEVuZHBvaW50OiBwcm9wcy5wcmljaW5nTWNwUnVudGltZUVuZHBvaW50IH0gfSxcbiAgICAgICAgfSxcbiAgICAgICAgQ3JlZGVudGlhbFByb3ZpZGVyQ29uZmlndXJhdGlvbnM6IFt7XG4gICAgICAgICAgQ3JlZGVudGlhbFByb3ZpZGVyVHlwZTogJ09BVVRIJyxcbiAgICAgICAgICBDcmVkZW50aWFsUHJvdmlkZXI6IHtcbiAgICAgICAgICAgIE9hdXRoQ3JlZGVudGlhbFByb3ZpZGVyOiB7XG4gICAgICAgICAgICAgIFByb3ZpZGVyQXJuOiBvYXV0aFByb3ZpZGVyQXJuLFxuICAgICAgICAgICAgICBTY29wZXM6IFsnbWNwLXJ1bnRpbWUtc2VydmVyL2ludm9rZSddLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9XSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgcHJpY2luZ1RhcmdldC5ub2RlLmFkZERlcGVuZGVuY3koZ2F0ZXdheSk7XG5cbiAgICBjb25zdCBkYXRhUHJvY2Vzc2luZ1RhcmdldCA9IG5ldyBjZGsuQ2ZuUmVzb3VyY2UodGhpcywgJ0RhdGFQcm9jZXNzaW5nTWNwVGFyZ2V0Jywge1xuICAgICAgdHlwZTogJ0FXUzo6QmVkcm9ja0FnZW50Q29yZTo6R2F0ZXdheVRhcmdldCcsXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIEdhdGV3YXlJZGVudGlmaWVyOiBnYXRld2F5SWQsXG4gICAgICAgIE5hbWU6ICdkYXRhUHJvY2Vzc2luZ01jcCcsXG4gICAgICAgIERlc2NyaXB0aW9uOiAnQVdTIExhYnMgRGF0YSBQcm9jZXNzaW5nIE1DUCBTZXJ2ZXIgKEF0aGVuYS9HbHVlKSBvbiBBZ2VudENvcmUgUnVudGltZScsXG4gICAgICAgIFRhcmdldENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBNY3A6IHsgTWNwU2VydmVyOiB7IEVuZHBvaW50OiBwcm9wcy5kYXRhUHJvY2Vzc2luZ01jcFJ1bnRpbWVFbmRwb2ludCB9IH0sXG4gICAgICAgIH0sXG4gICAgICAgIENyZWRlbnRpYWxQcm92aWRlckNvbmZpZ3VyYXRpb25zOiBbe1xuICAgICAgICAgIENyZWRlbnRpYWxQcm92aWRlclR5cGU6ICdPQVVUSCcsXG4gICAgICAgICAgQ3JlZGVudGlhbFByb3ZpZGVyOiB7XG4gICAgICAgICAgICBPYXV0aENyZWRlbnRpYWxQcm92aWRlcjoge1xuICAgICAgICAgICAgICBQcm92aWRlckFybjogb2F1dGhQcm92aWRlckFybixcbiAgICAgICAgICAgICAgU2NvcGVzOiBbJ21jcC1ydW50aW1lLXNlcnZlci9pbnZva2UnXSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfV0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGRhdGFQcm9jZXNzaW5nVGFyZ2V0Lm5vZGUuYWRkRGVwZW5kZW5jeShnYXRld2F5KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5nYXRld2F5QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdBZ2VudENvcmUgR2F0ZXdheSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUdhdGV3YXlBcm5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dhdGV3YXlVcmwnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5nYXRld2F5VXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdBZ2VudENvcmUgR2F0ZXdheSBVUkwnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7dGhpcy5zdGFja05hbWV9LUdhdGV3YXlVcmxgLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIENESy1OYWcgU3VwcHJlc3Npb25zXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKGdhdGV3YXlSb2xlLCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLCByZWFzb246ICdXaWxkY2FyZCBmb3IgQWdlbnRDb3JlIElkZW50aXR5IHRva2VuIGV4Y2hhbmdlIGFuZCBPQXV0aCBwcm92aWRlciBtYW5hZ2VtZW50LicgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhvYXV0aFByb3ZpZGVyRm4sIFtcbiAgICAgIHsgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsIHJlYXNvbjogJ1dpbGRjYXJkIHJlcXVpcmVkIGZvciBBZ2VudENvcmUgSWRlbnRpdHkgdG9rZW4gdmF1bHQgY3JlYXRpb24gYW5kIGJlZHJvY2stYWdlbnRjb3JlLWlkZW50aXR5IHNlY3JldHMgbmFtZXNwYWNlLicgfSxcbiAgICBdLCB0cnVlKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyh0aGlzLCBbXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLCByZWFzb246ICdBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgaXMgQVdTIGJlc3QgcHJhY3RpY2UuJywgYXBwbGllc1RvOiBbJ1BvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnXSB9LFxuICAgICAgeyBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JywgcmVhc29uOiAnV2lsZGNhcmQgZm9yIEFnZW50Q29yZSBJZGVudGl0eSB0b2tlbiBleGNoYW5nZSwgT0F1dGggY3JlZGVudGlhbCBwcm92aWRlciBtYW5hZ2VtZW50LicsIGFwcGxpZXNUbzogWydSZXNvdXJjZTo6KiddIH0sXG4gICAgICB7IGlkOiAnQXdzU29sdXRpb25zLUwxJywgcmVhc29uOiAnTGFtYmRhIHJ1bnRpbWUgdmVyc2lvbiBtYW5hZ2VkIGJ5IENESy4nIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==