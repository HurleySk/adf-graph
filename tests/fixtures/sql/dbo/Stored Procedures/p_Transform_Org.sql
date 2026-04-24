CREATE PROCEDURE [dbo].[p_Transform_Org]
AS
BEGIN
    SET NOCOUNT ON;

    -- Normalize org type codes and flag rows ready for Dataverse upsert
    UPDATE dbo.Org_Staging
    SET
        org_type_code = UPPER(LTRIM(RTRIM(org_type_code))),
        is_ready = 1
    WHERE
        org_id IS NOT NULL
        AND org_name IS NOT NULL
        AND is_ready = 0;
END
