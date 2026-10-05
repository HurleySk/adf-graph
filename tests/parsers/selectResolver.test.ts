import { describe, it, expect } from "vitest";
import { resolveSelect, parseFromClause } from "../../src/parsers/selectResolver.js";

const LOAD_SUBSCRIPTION = `SELECT a.Subscription_id as alm_folsubscriptionidfk
   ,a.Subscription_id as alm_esubscriptionname
  --,a.FAMIS_Docket_fk
  ,a.subscribe_dt as alm_subscribedate
 ,CASE WHEN a.Subscription_Type_Fk = 1 THEN 455780000
  WHEN a.Subscription_Type_Fk = 2 THEN 455780001
  END as alm_subscriptiontype
 ,b.alm_worksetid as alm_worksetid
 ,e.alm_employeeid as alm_fercstaffid
FROM
dbo.Wave3_Subscription_Staging a
LEFT JOIN DataVerse_alm_workset_Staging b
ON a.Work_Set_fk = b.alm_atmsworksetidfk
LEFT JOIN (SELECT Individual_fk, AD_User_fk, Row_Number() Over (Partition By Individual_fk Order By AD_User_fk) as rn FROM Wave3_AD_User_Individual_Staging) c
on a.Individual_fk = c.Individual_fk and c.rn = 1
LEFT JOIN ATMS_AD_User_Staging d
ON c.AD_User_fk = d.AD_User_Id
LEFT JOIN (SELECT alm_employeeid, concat(alm_firstname,alm_middlename,alm_lastname) as name_key, Row_Number() Over (Partition By concat(alm_firstname,alm_middlename,alm_lastname) Order By alm_employeeid) as rn FROM Wave3_employee_Staging WHERE concat(alm_firstname,alm_middlename,alm_lastname) <> '') e
ON e.name_key = concat(d.First_Name,d.Middle_Name,d.Last_Name) and e.rn = 1
order by Subscription_id`;

describe("resolveSelect on Load Subscription", () => {
  const r = resolveSelect(LOAD_SUBSCRIPTION);
  const item = (alias: string) => r.items.find((i) => i.alias === alias)!;

  it("lists every aliased item and skips commented ones", () => {
    expect(r.items.map((i) => i.alias)).toEqual([
      "alm_folsubscriptionidfk", "alm_esubscriptionname", "alm_subscribedate",
      "alm_subscriptiontype", "alm_worksetid", "alm_fercstaffid",
    ]);
  });

  it("resolves a qualified column to its FROM table", () => {
    expect(item("alm_esubscriptionname").refs).toEqual([
      { qualifier: "a", column: "Subscription_id", table: "dbo.Wave3_Subscription_Staging", derived: false },
    ]);
  });

  it("marks CASE items", () => {
    expect(item("alm_subscriptiontype").isCase).toBe(true);
    expect(item("alm_subscriptiontype").refs.map((x) => x.column)).toEqual(["Subscription_Type_Fk"]);
  });

  it("records the join condition of a joined source", () => {
    expect(item("alm_worksetid").refs[0].table).toBe("DataVerse_alm_workset_Staging");
    expect(r.sources.find((s) => s.alias === "b")!.joinCondition).toBe("a.Work_Set_fk = b.alm_atmsworksetidfk");
  });

  it("follows a derived table to its base table", () => {
    expect(item("alm_fercstaffid").refs).toEqual([
      { qualifier: "e", column: "alm_employeeid", table: "Wave3_employee_Staging", derived: true },
    ]);
  });

  it("lists sources in order and stops at ORDER BY", () => {
    expect(r.sources.map((s) => s.alias)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("resolveSelect edge cases", () => {
  it("resolves unqualified columns when there is one source, and keeps constants ref-free", () => {
    const r = resolveSelect(`SELECT Country_Name AS alm_name, 'x' AS alm_src FROM dbo.Country_Staging`);
    expect(r.items[0].refs).toEqual([{ qualifier: "Country_Staging", column: "Country_Name", table: "dbo.Country_Staging", derived: false }]);
    expect(r.items[1].refs).toEqual([]);
  });

  it("follows a CTE", () => {
    const r = resolveSelect(`WITH s AS (SELECT Id, Nm FROM dbo.T) SELECT s.Nm AS alm_name FROM s`);
    expect(r.items[0].refs).toEqual([{ qualifier: "s", column: "Nm", table: "dbo.T", derived: true }]);
  });

  it("skips table hints", () => {
    const sources = parseFromClause(`dbo.T a WITH (NOLOCK) JOIN dbo.U u WITH (NOLOCK) ON u.Id = a.Id`);
    expect(sources).toEqual([
      { alias: "a", table: "dbo.T" },
      { alias: "u", table: "dbo.U", joinCondition: "u.Id = a.Id" },
    ]);
  });

  it("reads an alias written without AS", () => {
    expect(resolveSelect(`SELECT a.Id alm_id FROM dbo.T a`).items[0].alias).toBe("alm_id");
  });

  it("keeps an unqualified column with several sources as an unresolved ref", () => {
    const r = resolveSelect(`SELECT Nm AS alm_name FROM dbo.T a JOIN dbo.U b ON a.Id = b.Id`);
    expect(r.items[0].refs).toEqual([{ qualifier: null, column: "Nm", table: null, derived: false }]);
  });

  it("does not read a function name or a type as a column", () => {
    const r = resolveSelect(`SELECT DATEADD(HOUR, 12, CAST(CAST(t.Dt AS DATE) AS DATETIME)) AS alm_date FROM dbo.T t`);
    expect(r.items[0].refs.map((x) => x.column)).toEqual(["Dt"]);
  });

  it("resolves an unqualified column through the one derived source that outputs it", () => {
    const r = resolveSelect(`WITH c AS (SELECT a.Id, a.Nm FROM dbo.T a) SELECT Nm AS alm_name, t2.X AS alm_x FROM c LEFT JOIN dbo.U t2 ON c.Id = t2.Id`);
    expect(r.items[0].refs).toEqual([{ qualifier: "c", column: "Nm", table: "dbo.T", derived: true }]);
  });

  it("follows a CTE that reads an earlier CTE", () => {
    const r = resolveSelect(`WITH w AS (SELECT Id, Dt FROM dbo.W), c AS (SELECT a.Id, w.Dt FROM dbo.T a LEFT JOIN w ON w.Id = a.Id) SELECT c.Dt AS alm_dt FROM c`);
    expect(r.items[0].refs).toEqual([{ qualifier: "c", column: "Dt", table: "dbo.W", derived: true }]);
  });

  it("flags a star select", () => {
    expect(resolveSelect(`SELECT t.* FROM dbo.T t`)).toMatchObject({ items: [], star: true, warnings: [] });
    expect(resolveSelect(`SELECT t.Id FROM dbo.T t`).star).toBe(false);
  });
});
