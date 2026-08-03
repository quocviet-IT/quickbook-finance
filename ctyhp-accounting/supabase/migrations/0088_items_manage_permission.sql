-- Who may maintain the product catalog becomes a permission rather than a role
-- test, so the permission matrix screen is the only place that answers it.
insert into acc_permission (key, label, category, description, is_enforced) values
  ('items.manage', 'Manage products and services', 'Sales',
   'Create and edit products and services, and activate or deactivate them', true)
on conflict (key) do nothing;

-- Earlier migrations seeded acc_role_permission by naming the three roles
-- literally, so 'sales' has no rows at all -- and neither does any role for a
-- permission added after it was seeded. acc_has_permission is fail-closed and
-- would already deny, but the matrix screen renders one cell per stored row:
-- without these an admin sees a blank they cannot toggle.
insert into acc_role_permission (role, permission_key, allowed)
select r.role, p.key, false
  from (select unnest(enum_range(null::acc_app_role)) as role) r
 cross join acc_permission p
 where not exists (
   select 1
     from acc_role_permission rp
    where rp.role = r.role
      and rp.permission_key = p.key
 );

update acc_role_permission
   set allowed = true
 where permission_key = 'items.manage'
   and role in ('admin', 'accountant', 'sales');

-- The catalog was gated by "are you staff". One rule, one place: the grant
-- matrix. An admin who revokes items.manage from accountants now actually
-- revokes it, instead of being overruled by a role test hidden in RLS.
drop policy if exists acc_item_write on acc_item;
create policy acc_item_write on acc_item for all
  using (acc_has_permission('items.manage'))
  with check (acc_has_permission('items.manage'));
