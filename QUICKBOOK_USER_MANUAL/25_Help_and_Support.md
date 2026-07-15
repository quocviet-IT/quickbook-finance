# 25. Help and Support

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 126-129.

## Purpose

This chapter explains the support channels documented in QuickBooks Online, including in-product help, Community, Callback, Live Chat, QB Assistant, customer-care support, online self-help, and social communities.

It also translates the documented workflow into design requirements for an internal support and knowledge-management system.

> **Important**
>
> This chapter reflects the QuickBooks Australia support experience documented in July 2022. Support channels, operating hours, contact paths, product experiments, social communities, and assistant availability may have changed. Verify current support information through official product channels.

---

## 1. Support Channel Overview

The source manual describes several support options:

```text
In-Product Help
Community
Callback
Live Chat
QB Assistant
Customer Care
Online Self-Help
Professional and Social Communities
```

A user should begin with self-service help and move to assisted support when the issue cannot be resolved.

Recommended escalation path:

```text
Search Knowledge Base
        ↓
Review Suggested Article
        ↓
Use Digital Assistant
        ↓
Ask Community
        ↓
Start Live Chat or Request Callback
        ↓
Escalate to Specialist Support
```

---

## 2. Access In-Product Support

The documented workflow is:

1. Select the **question mark** icon in the top-right corner of the QuickBooks Online screen.
2. Enter a question in the search box.
3. Select the relevant article to open it.
4. Select **Contact Us** when more assistance is required.
5. Choose an available support channel such as Community, Callback, or Live Chat.

### Recommended search behavior

A support search should accept:

- natural-language questions;
- product feature names;
- error messages;
- transaction references;
- accounting terms;
- workflow keywords.

Example queries:

```text
How do I reconcile a bank account?
Why is my invoice still unpaid?
How do I correct a GST transaction?
Why did a bank transaction import twice?
How do I add a new user?
```

---

## 3. Knowledge Articles

A useful knowledge article should include:

| Section | Purpose |
|---|---|
| Title | Clearly describes the problem or task |
| Applies to | Product, plan, region, and version |
| Symptoms | What the user sees |
| Cause | Known reason where available |
| Resolution | Step-by-step instructions |
| Validation | How to confirm the issue is resolved |
| Limitations | Known exceptions |
| Related articles | Additional guidance |
| Last reviewed | Freshness indicator |
| Owner | Person or team responsible |

### Article lifecycle

```text
Draft
    ↓
Technical Review
    ↓
Business Review
    ↓
Published
    ↓
Periodic Review
    ↓
Updated or Archived
```

---

## 4. Contact Us Options

The source manual shows the following assisted-support choices:

### Community

Use Community to:

- ask questions;
- search previous discussions;
- review answers from experts and other customers;
- compare common solutions.

### Callback

Use Callback when the user needs direct assistance by telephone.

A callback request should capture:

- user name;
- company or account;
- phone number;
- timezone;
- preferred contact time;
- issue category;
- problem summary;
- urgency;
- consent to contact.

### Live Chat

Use Live Chat for real-time text-based support.

A chat system should preserve:

- conversation transcript;
- agent;
- start and end time;
- issue category;
- linked account or transaction;
- resolution status;
- customer rating;
- follow-up actions.

---

## 5. QB Assistant

The source manual describes QB Assistant as a digital assistant that was in beta at the time.

The documented activation process was:

```text
Gear Icon
> QuickBooks Labs
> QB Assistant
> Turn On
> Done
```

To use it in the desktop browser, the manual directs users to select the assistant icon between the Help and Gear icons.

The source states that users could:

- select pre-populated questions;
- enter a question in the question box;
- receive responses improved through machine learning.

> **Historical note**
>
> The QB Assistant description is specific to the 2022 manual. Do not assume that the experiment, activation path, or feature still exists in the same form.

---

## 6. Recommended AI Assistant Boundaries

An internal support assistant should clearly separate:

```text
Informational Guidance
Suggested Navigation
Data Lookup
Drafted Actions
Approved Actions
Restricted Actions
```

### The assistant may safely:

- search approved documentation;
- explain system workflows;
- summarize error messages;
- identify relevant support articles;
- draft troubleshooting steps;
- create a support ticket draft;
- show transaction or system status when permitted.

### The assistant should not automatically:

- change financial transactions;
- delete accounting records;
- change user permissions;
- lodge tax returns;
- release payments;
- modify payroll;
- disclose sensitive data;
- claim certainty without reliable evidence.

High-risk actions should require explicit user confirmation, permission checks, and audit logging.

---

## 7. Assistant Response Quality

Recommended response principles:

1. State the issue in clear language.
2. Identify the relevant product area.
3. Provide the shortest safe resolution path.
4. Distinguish confirmed facts from assumptions.
5. Mention irreversible effects before the user acts.
6. Link to the relevant source article.
7. Escalate when confidence is low.
8. Avoid requesting unnecessary sensitive information.
9. Confirm whether the issue is resolved.
10. Record unresolved gaps for support follow-up.

### Confidence levels

| Confidence | Recommended behavior |
|---|---|
| High | Provide direct steps with source citation |
| Medium | Provide likely steps and request validation |
| Low | Avoid action instructions and escalate |
| Restricted | Refuse the action and route to an authorized user |

---

## 8. Customer Care Support

The source manual states that customers and accounting professionals could contact customer care by phone or online chat.

For QuickBooks Online Accountant users, the documented path was:

```text
QuickBooks Online Accountant
> ProAdvisor
> Support
```

A modern internal support directory should display:

- support channel;
- operating hours;
- timezone;
- supported language;
- expected response time;
- supported product or module;
- eligibility requirements;
- escalation path;
- service-status link.

---

## 9. Online Self-Help

The manual directs users to an Intuit self-help support site for current support information.

For an internal platform, self-help content should include:

- getting-started guides;
- workflow instructions;
- troubleshooting articles;
- error-code references;
- release notes;
- known incidents;
- training videos;
- frequently asked questions;
- role-specific guides;
- downloadable templates.

### Search ranking recommendations

Rank results using:

- exact error-message match;
- product and module match;
- user role;
- region;
- version;
- recency;
- article quality score;
- prior resolution rate.

---

## 10. Professional and Social Communities

The source references QuickBooks Australia and ProAdvisor communities and social channels.

Communities can provide:

- peer support;
- product updates;
- workflow examples;
- implementation discussions;
- common troubleshooting patterns.

### Community limitations

Community content may be:

- outdated;
- incomplete;
- region-specific;
- written for another subscription plan;
- inconsistent with official policy;
- unsuitable for confidential issues.

Community answers should therefore be treated as supplementary guidance rather than authoritative accounting, legal, tax, payroll, or security instructions.

---

## 11. Support Ticket Creation

When self-service does not resolve an issue, create a structured support ticket.

Recommended ticket fields:

| Field | Description |
|---|---|
| Ticket number | Unique reference |
| Requester | User reporting the issue |
| Organization | Company or legal entity |
| Product/module | Affected system area |
| Category | Incident, question, access, data, defect, request |
| Summary | Concise issue title |
| Description | Detailed explanation |
| Steps to reproduce | Repeatable workflow |
| Expected result | What should happen |
| Actual result | What happened |
| Impact | Business effect |
| Priority | Urgency and impact classification |
| Environment | Production, testing, development |
| Attachments | Screenshots, logs, or documents |
| Assigned team | Responsible support group |
| Status | Current ticket state |
| Resolution | Final outcome |

---

## 12. Priority and Severity

Recommended classification:

| Priority | Example |
|---|---|
| P1 - Critical | System unavailable, payroll/payment blocked, major data integrity issue |
| P2 - High | Important workflow unavailable with no practical workaround |
| P3 - Normal | Functional issue with a workaround |
| P4 - Low | Question, cosmetic issue, or enhancement request |

### Priority calculation

```text
Priority = Business Impact + Urgency + Risk
```

Priority should not be determined by urgency alone.

---

## 13. Support Ticket Statuses

```text
New
    ↓
Triaged
    ↓
Assigned
    ↓
In Progress
    ↓
Waiting for Customer
    ↓
Resolved
    ↓
Closed
```

Alternative statuses:

```text
Escalated
Blocked
Duplicate
Cancelled
Reopened
```

### Status controls

- every change records user and timestamp;
- Waiting for Customer requires a clear request;
- Resolved requires a resolution summary;
- Closed tickets remain searchable;
- Reopened tickets retain the prior resolution history.

---

## 14. Support Escalation

Recommended escalation tiers:

```text
Tier 0 - Self-Service Knowledge Base
Tier 1 - General Support
Tier 2 - Product or Accounting Specialist
Tier 3 - Engineering or Integration Team
Tier 4 - Security, Compliance, or Executive Incident Team
```

Escalate based on:

- business impact;
- security or privacy risk;
- financial-data integrity;
- statutory deadline;
- repeated failure;
- missing product capability;
- unresolved root cause.

---

## 15. Internal Support Workflow

```text
User Searches Help
        ↓
Knowledge Article Suggested
        ↓
Assistant Provides Guided Troubleshooting
        ↓
User Confirms Outcome
        ↓
Resolved?
   ├── Yes → Capture Feedback and Close
   └── No  → Create Support Ticket
                    ↓
                 Triage
                    ↓
                 Assign
                    ↓
              Investigate
                    ↓
          Resolve and Validate
                    ↓
          Update Knowledge Base
```

A resolved issue should improve future self-service content whenever the solution is reusable.

---

## 16. Screenshot and Diagnostic Requirements

For reproducible support reports, collect:

- screenshot of the error;
- date and time;
- user role;
- affected module;
- environment;
- steps performed;
- expected result;
- actual result;
- browser or app version;
- transaction or record reference;
- relevant logs where permitted.

### Privacy rule

Screenshots and logs should be reviewed before sharing to remove:

- passwords;
- full bank details;
- tax identifiers;
- payroll information;
- personal addresses;
- API keys;
- access tokens;
- unrelated customer data.

---

## 17. Service Level Targets

An internal support platform may define targets such as:

| Priority | First response | Target update frequency |
|---|---|---|
| P1 | 15-30 minutes | Every 30-60 minutes |
| P2 | 1-2 hours | Every 2-4 hours |
| P3 | 1 business day | Daily |
| P4 | 2 business days | As agreed |

> **Design recommendation**
>
> These are example internal targets, not QuickBooks service commitments from the source manual.

---

## 18. Support Metrics

Recommended metrics:

- ticket volume;
- first-response time;
- resolution time;
- first-contact resolution rate;
- reopen rate;
- customer satisfaction;
- backlog by priority;
- knowledge article usage;
- search success rate;
- assistant containment rate;
- escalation rate;
- recurring issue rate;
- defect-to-resolution time.

### Knowledge effectiveness

```text
Self-Service Success Rate
= Sessions Resolved Without Ticket / Total Help Sessions
```

---

## 19. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Outdated article | User follows an old product workflow | Review date and version labeling |
| Incorrect AI guidance | Assistant suggests a risky accounting change | Confidence threshold and escalation |
| Sensitive-data exposure | User uploads payroll or bank details | Redaction guidance and restricted access |
| Lost support history | Chat is not retained | Ticket and transcript storage |
| Duplicate tickets | Same incident reported repeatedly | Similarity detection and incident linking |
| Weak escalation | Critical issue remains with general support | Severity rules and alerting |
| Unauthorized support access | Agent sees unrelated company data | Tenant isolation and role-based permissions |
| Unverified community answer | User treats peer advice as official | Source labeling and disclaimer |
| Support action without approval | Agent edits financial data directly | Controlled action permissions and audit log |
| Stale contact information | User calls an obsolete number | Central support-directory ownership |

---

## 20. Recommended Database Design

### `knowledge_articles`

```text
id
title
slug
product_area
region
version_scope
content
status
owner_id
published_at
last_reviewed_at
next_review_at
created_at
updated_at
```

### `support_tickets`

```text
id
ticket_number
requester_id
organization_id
category
priority
product_area
summary
description
environment
status
assigned_team_id
assigned_user_id
resolved_at
closed_at
created_at
updated_at
```

### `support_ticket_events`

```text
id
ticket_id
event_type
old_value
new_value
comment
created_by
created_at
```

### `support_conversations`

```text
id
ticket_id
channel
started_at
ended_at
agent_id
transcript_location
customer_rating
created_at
```

### `assistant_interactions`

```text
id
user_id
organization_id
question
response
source_references
confidence_score
resolution_status
escalated_ticket_id
created_at
```

### Supporting tables

```text
support_teams
support_assignments
support_attachments
support_sla_policies
support_sla_events
knowledge_article_feedback
known_incidents
support_audit_history
```

---

## 21. Recommended Constraints

1. Ticket number must be unique.
2. Published articles require an owner and review date.
3. Archived articles cannot appear as primary search results.
4. High-risk assistant responses require source references.
5. P1 tickets require immediate escalation and notification.
6. Resolution requires a summary.
7. Restricted attachments require permission checks.
8. Support agents cannot access organizations outside their assigned scope.
9. Financial actions require normal product permissions and approval.
10. Ticket and article history must be immutable or fully versioned.

---

## 22. AI Implementation Prompt

```text
Implement a Help and Support module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Provide in-product Help search and contextual article suggestions.
- Support knowledge articles with product, region, version, owner, review date, and lifecycle status.
- Provide an AI support assistant grounded only in approved knowledge sources.
- Display source references and confidence level with assistant responses.
- Escalate low-confidence, high-risk, financial, payroll, tax, payment, security, and permission issues.
- Support Community links, callback requests, live chat, and support-ticket creation through configurable adapters.
- Capture structured tickets with impact, urgency, priority, environment, reproduction steps, expected result, actual result, and attachments.
- Support New, Triaged, Assigned, In Progress, Waiting for Customer, Resolved, Closed, Escalated, and Reopened statuses.
- Implement SLA targets, escalation rules, notifications, and breach alerts.
- Store chat transcripts, ticket events, resolution summaries, feedback, and immutable audit history.
- Support screenshot and log attachments with malware scanning and access controls.
- Enforce tenant isolation and role-based agent access.
- Prevent the support assistant from changing financial records without normal permission, confirmation, and approval workflows.
- Provide dashboards for backlog, response time, resolution time, reopen rate, satisfaction, search success, assistant containment, and recurring issues.
- Include unit and integration tests for search, grounding, permissions, tenant isolation, escalation, SLA calculation, ticket transitions, and audit history.
```

---

## 23. Internal System Checklist

- [ ] Help is accessible within the product.
- [ ] Search supports natural-language questions and error messages.
- [ ] Knowledge articles identify region, version, owner, and review date.
- [ ] Outdated content is archived or clearly labeled.
- [ ] AI responses cite approved sources.
- [ ] Low-confidence and high-risk issues are escalated.
- [ ] Community advice is labeled as non-authoritative.
- [ ] Callback and Live Chat requests are recorded.
- [ ] Support tickets capture reproducible evidence.
- [ ] Sensitive screenshots and logs are protected.
- [ ] Priority and SLA rules are documented.
- [ ] Ticket status history is retained.
- [ ] Support agents have scoped access.
- [ ] Financial actions remain subject to product permissions.
- [ ] Resolved issues feed improvements to the knowledge base.
- [ ] Support performance metrics are monitored.

---

## Related Topics

- [02. Navigation](02_Navigation.md)
- [05. Audit Log](05_Audit_Log.md)
- [08. Managing Users](08_Managing_Users.md)
- [24. Mobile App](24_Mobile_App.md)
- Product Training
- Incident Management
- Release Notes
- Security and Privacy

---

## Keywords

Help, Support, in-product support, Community, Callback, Live Chat, QB Assistant, customer care, online support, knowledge base, support ticket, escalation, SLA, troubleshooting, AI support assistant, ProAdvisor