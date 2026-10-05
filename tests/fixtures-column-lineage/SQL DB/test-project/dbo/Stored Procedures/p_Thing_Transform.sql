CREATE PROCEDURE [dbo].[p_Thing_Transform]
AS
BEGIN
    UPDATE dbo.Wave3_Thing_Staging
    SET Clean_Name = UPPER(LTRIM(RTRIM(Thing_Name)))
END
