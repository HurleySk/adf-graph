CREATE TABLE [dbo].[Work_Item_Staging](
	[Work_Item_id] [int] NOT NULL,
	[Work_Item_fk] [int] NULL,
	[FERC_Staff_fk] [int] NULL,
	[Work_Item_Inactive_Date] [datetime] NULL,
 CONSTRAINT [PK_Work_Item_Staging] PRIMARY KEY CLUSTERED
(
	[Work_Item_id] ASC
)WITH (STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
