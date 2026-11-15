'use strict';

// The client-written change entries both update routes accept.
async function insertChangeLog(db, id, entries, user) {
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || !entry.field) continue;
        const changedAt = entry.date ? new Date(entry.date) : new Date();
        await db.query(
            `INSERT INTO order_changes
              (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                id,
                user?.id || null,
                user?.username || entry.changedBy || null,
                isNaN(changedAt) ? new Date() : changedAt,
                String(entry.field),
                entry.oldValue != null ? String(entry.oldValue) : null,
                entry.newValue != null ? String(entry.newValue) : null,
                entry.reason || null,
                entry.stage || null,
            ]
        );
    }
}

module.exports = { insertChangeLog };
