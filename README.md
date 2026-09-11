# Database Systems Project — Seller Operations Platform

A database-backed seller operations project built to demonstrate relational database design, SQL Server integration, authentication/session handling, and a small web application around ecommerce order data.

## What the project demonstrates

- relational schema design in Microsoft SQL Server
- seller/business records
- ecommerce-oriented data relationships
- SQL setup and sample-data scripts
- Node.js / Express API and web-server integration
- server-side sessions
- SQL Server connectivity from Node.js
- simple login/signup and dashboard-style frontend pages

The sample dataset uses a fictional/demo seller based on the Waqtoro storefront project.

## Tech stack

- Microsoft SQL Server
- T-SQL
- Node.js
- Express
- `mssql`
- `msnodesqlv8`
- Express Session
- HTML / CSS / JavaScript frontend pages

## Repository structure

```text
1_Schema.sql          # Database schema
3_DataTesting.sql     # Sample/test data and queries
app.js                # Express application
public/               # Browser-facing pages
package.json          # Node dependencies and scripts
```

## Run locally

1. Create/configure a local SQL Server database.
2. Run the SQL setup scripts in the intended order.
3. Install Node dependencies:

```bash
npm install
```

4. Configure the application's local database connection as required by the code.
5. Start the web application:

```bash
npm start
```

## Project status

This is an academic database-systems project intended to demonstrate database modelling and application/database integration rather than a production ecommerce service.
