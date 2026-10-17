# User administration

Process Navigator keeps its demonstration user directory locally and does not
require an Internet identity provider. Administrators and super-administrators
can open **Пользователи** in the application header, assign one of the predefined
roles and enable or disable an account.

Permissions are owned by roles rather than individual users. The server applies
the same permission checks as the interface, so hiding a button is never the only
access-control measure.

The directory is written to `Data/Users/users.json` at runtime. This folder is
ignored by Git and can later be replaced by an adapter for 1C users, operating
system accounts or an internal LDAP/Active Directory without changing process
permissions.

Safety rules:

- an administrator cannot disable the account currently in use;
- the last active super-administrator cannot be disabled or demoted;
- disabled accounts are omitted from the user switcher and rejected by the API;
- unknown roles and empty display names are rejected by the server.
