-- Align the existing permission catalog with administrator-created accounts.
-- Account creation uses auth.admin.createUser and does not send email.
update acc_permission
   set description = 'Create users, change roles, suspend, offboard'
 where key = 'users.manage';
