CREATE TABLE [dbo].[Org_Staging] (
    [org_id]        NVARCHAR(50)   NOT NULL,
    [org_name]      NVARCHAR(255)  NOT NULL,
    [org_type_code] NVARCHAR(50)   NULL,
    [dv_org_guid]   UNIQUEIDENTIFIER NULL,
    [is_ready]      BIT            NOT NULL CONSTRAINT [DF_Org_Staging_is_ready] DEFAULT (0),
    CONSTRAINT [PK_Org_Staging] PRIMARY KEY CLUSTERED ([org_id] ASC)
);
