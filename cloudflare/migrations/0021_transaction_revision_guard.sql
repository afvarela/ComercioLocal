CREATE TABLE cloud_revision_guarded(
  id INTEGER PRIMARY KEY CHECK(id=1),
  version INTEGER NOT NULL CHECK(version>=0)
);

INSERT INTO cloud_revision_guarded(id,version)
SELECT id,MAX(version,0) FROM cloud_revision WHERE id=1;

DROP TABLE cloud_revision;
ALTER TABLE cloud_revision_guarded RENAME TO cloud_revision;
