"use client";

import { useState, useEffect, useCallback } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Search, RefreshCw, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";

type UserRole = "ADMIN" | "EMPLOYEE" | "CUSTOMER";

interface User {
	id: string;
	email: string;
	fullName: string;
	phone: string | null;
	role: UserRole;
	createdAt: string;
	_count: {
		orders: number;
		fulfilledOrders: number;
	};
}

const ROLE_COLORS: Record<UserRole, string> = {
	ADMIN: "bg-purple-100 text-purple-800",
	EMPLOYEE: "bg-blue-100 text-blue-800",
	CUSTOMER: "bg-gray-100 text-gray-800",
};

const EMPTY_CREATE = {
	email: "",
	password: "",
	fullName: "",
	phone: "",
	role: "EMPLOYEE" as UserRole,
};

const EMPTY_EDIT = {
	fullName: "",
	phone: "",
	role: "EMPLOYEE" as UserRole,
	password: "",
};

export default function UsersSection() {
	const [offset, setOffset] = useState(0);
	const [users, setUsers] = useState<User[]>([]);
  const [roleCounts, setRoleCounts] = useState<Record<UserRole, number>>({ ADMIN: 0, EMPLOYEE: 0, CUSTOMER: 0 });
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState("");
	const [filterRole, setFilterRole] = useState("all");

	// Create dialog state
	const [createOpen, setCreateOpen] = useState(false);
	const [createForm, setCreateForm] = useState(EMPTY_CREATE);
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	// Edit dialog state
	const [editUser, setEditUser] = useState<User | null>(null);
	const [editForm, setEditForm] = useState(EMPTY_EDIT);
	const [saving, setSaving] = useState(false);
	const [editError, setEditError] = useState<string | null>(null);

	// Delete state
	const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchUsers = useCallback((signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: "20", offset: String(offset) });
    if (filterRole !== "all") params.set("role", filterRole);
    if (searchTerm) params.set("search", searchTerm);
    return api.get<{ users: User[]; pagination: { total: number }; summary: Record<UserRole, number> }>(`/api/admin/users?${params}`, { signal })
      .then(data => { if (!signal?.aborted) { setUsers(data.users); setTotal(data.pagination.total); setRoleCounts(data.summary); setError(null); } })
      .catch(cause => { if (!signal?.aborted) setError(cause.message || "Failed to fetch users"); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [filterRole, searchTerm, offset]);

	useEffect(() => {
    const controller = new AbortController();
    void fetchUsers(controller.signal);
    return () => controller.abort();
  }, [fetchUsers]);

	// ── Create User ────────────────────────────────────────────────────────────
	const handleCreate = async () => {
		if (!createForm.email || !createForm.password || !createForm.fullName) {
			setCreateError("Email, password, and full name are required");
			return;
		}
		setCreating(true);
		setCreateError(null);
		try {
			await api.post("/api/admin/users", createForm);
			setCreateForm(EMPTY_CREATE);
			setCreateOpen(false);
			await fetchUsers();
		} catch (err: any) {
			setCreateError(err.message || "Failed to create user");
		} finally {
			setCreating(false);
		}
	};

	// ── Edit User ──────────────────────────────────────────────────────────────
	const openEdit = (user: User) => {
		setEditUser(user);
		setEditForm({
			fullName: user.fullName,
			phone: user.phone || "",
			role: user.role,
			password: "",
		});
		setEditError(null);
	};

	const handleSave = async () => {
		if (!editUser) return;
		setSaving(true);
		setEditError(null);
		try {
			const payload: Record<string, any> = {
				fullName: editForm.fullName,
				phone: editForm.phone || null,
				role: editForm.role,
			};
			if (editForm.password) payload.password = editForm.password;
			await api.patch(`/api/admin/users/${editUser.id}`, payload);
			setEditUser(null);
			await fetchUsers();
		} catch (err: any) {
			setEditError(err.message || "Failed to save changes");
		} finally {
			setSaving(false);
		}
	};

	// ── Delete User ────────────────────────────────────────────────────────────
	const handleDelete = async (userId: string, userName: string) => {
		if (!confirm(`Delete user "${userName}"? This cannot be undone.`)) return;
		setDeletingId(userId);
		try {
			await api.delete(`/api/admin/users/${userId}`);
			await fetchUsers();
		} catch (err: any) {
			alert(err.message || "Failed to delete user");
		} finally {
			setDeletingId(null);
		}
	};

	const adminCount = roleCounts.ADMIN;
	const employeeCount = roleCounts.EMPLOYEE;
	const customerCount = roleCounts.CUSTOMER;

	return (
		<div className="space-y-6">
			{/* Stats */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Total Users</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold">{roleCounts.ADMIN + roleCounts.EMPLOYEE + roleCounts.CUSTOMER}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Admins</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-blue-700">
							{adminCount}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Employees</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-blue-600">
							{employeeCount}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Customers</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-gray-700">
							{customerCount}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Users Table */}
			<Card>
				<CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3">
					<div>
						<CardTitle>User Management</CardTitle>
						<CardDescription>
							Create, update, and manage all system users
						</CardDescription>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => { setLoading(true); void fetchUsers(); }}
							disabled={loading}>
							<RefreshCw
								className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
							/>
							Refresh
						</Button>

						{/* Create User Dialog */}
						<Dialog open={createOpen} onOpenChange={setCreateOpen}>
							<DialogTrigger asChild>
								<Button size="sm">
									<Plus className="h-4 w-4 mr-2" />
									Add User
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Create New User</DialogTitle>
									<DialogDescription>
										Add a new user to the system. Share the email and password securely with them.
									</DialogDescription>
								</DialogHeader>
								<div className="space-y-4">
									{createError && (
										<div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
											{createError}
										</div>
									)}
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
										<div className="sm:col-span-2">
											<Label htmlFor="create-name">Full Name *</Label>
											<Input
												id="create-name"
												placeholder="John Doe"
												value={createForm.fullName}
												onChange={(e) =>
													setCreateForm({
														...createForm,
														fullName: e.target.value,
													})
												}
											/>
										</div>
										<div className="sm:col-span-2">
											<Label htmlFor="create-email">Email *</Label>
											<Input
												id="create-email"
												type="email"
												placeholder="user@example.com"
												value={createForm.email}
												onChange={(e) =>
													setCreateForm({
														...createForm,
														email: e.target.value,
													})
												}
											/>
										</div>
										<div className="sm:col-span-2">
											<Label htmlFor="create-password">Password *</Label>
											<Input
												id="create-password"
												type="password"
												placeholder="Minimum 8 characters"
												value={createForm.password}
												onChange={(e) =>
													setCreateForm({
														...createForm,
														password: e.target.value,
													})
												}
											/>
										</div>
										<div>
											<Label htmlFor="create-phone">Phone</Label>
											<Input
												id="create-phone"
												placeholder="+91 XXXXX XXXXX"
												value={createForm.phone}
												onChange={(e) =>
													setCreateForm({
														...createForm,
														phone: e.target.value,
													})
												}
											/>
										</div>
										<div>
											<Label>Role</Label>
											<Select
												value={createForm.role}
												onValueChange={(v) =>
													setCreateForm({ ...createForm, role: v as UserRole })
												}>
												<SelectTrigger aria-label="User role">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="ADMIN">Admin</SelectItem>
													<SelectItem value="EMPLOYEE">Employee</SelectItem>
													<SelectItem value="CUSTOMER">Customer</SelectItem>
												</SelectContent>
											</Select>
										</div>
									</div>
									<div className="flex gap-2 justify-end">
										<Button
											variant="outline"
											onClick={() => {
												setCreateOpen(false);
												setCreateForm(EMPTY_CREATE);
												setCreateError(null);
											}}>
											Cancel
										</Button>
										<Button onClick={handleCreate} disabled={creating}>
											{creating ? (
												<Loader2 className="h-4 w-4 mr-2 animate-spin" />
											) : null}
											Create User
										</Button>
									</div>
								</div>
							</DialogContent>
						</Dialog>
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col sm:flex-row gap-4 mb-6">
						<div className="flex-1 relative">
							<Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
							<Input
								aria-label="Search users" placeholder="Search by name or email..."
								value={searchTerm}
								onChange={(e) => { setSearchTerm(e.target.value); setOffset(0); setLoading(true); }}
								className="pl-10"
							/>
						</div>
						<select
							aria-label="Filter users by role" value={filterRole}
							onChange={(e) => { setFilterRole(e.target.value); setOffset(0); setLoading(true); }}
							className="native-select sm:max-w-48">
							<option value="all">All Roles</option>
							<option value="ADMIN">Admin</option>
							<option value="EMPLOYEE">Employee</option>
							<option value="CUSTOMER">Customer</option>
						</select>
					</div>

					{error && (
						<div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4">
							{error}
						</div>
					)}

					{loading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="h-8 w-8 animate-spin text-gray-400" />
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Email</TableHead>
										<TableHead>Phone</TableHead>
										<TableHead>Role</TableHead>
										<TableHead className="text-center">Orders</TableHead>
										<TableHead className="text-center">Deliveries</TableHead>
										<TableHead>Joined</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{users.map((user) => (
										<TableRow key={user.id}>
											<TableCell className="font-medium">
												{user.fullName}
											</TableCell>
											<TableCell className="text-sm text-gray-600">
												{user.email}
											</TableCell>
											<TableCell className="text-sm">
												{user.phone || "—"}
											</TableCell>
											<TableCell>
												<Badge className={ROLE_COLORS[user.role]}>
													{user.role}
												</Badge>
											</TableCell>
											<TableCell className="text-center">
												{user._count.orders}
											</TableCell>
											<TableCell className="text-center">
												{user._count.fulfilledOrders}
											</TableCell>
											<TableCell className="text-sm text-gray-600">
												{new Date(user.createdAt).toLocaleDateString("en-IN")}
											</TableCell>
											<TableCell className="text-right">
												<div className="flex gap-2 justify-end">
													{/* Edit Dialog */}
													<Dialog
														open={editUser?.id === user.id}
														onOpenChange={(open) => {
															if (!open) setEditUser(null);
														}}>
														<DialogTrigger asChild>
															<Button
																variant="outline"
																size="sm"
																aria-label={`Edit ${user.fullName}`} onClick={() => openEdit(user)}>
																<Pencil className="h-3 w-3" />
															</Button>
														</DialogTrigger>
														<DialogContent>
															<DialogHeader>
																<DialogTitle>Edit User</DialogTitle>
																<DialogDescription>
																	{user.email}
																</DialogDescription>
															</DialogHeader>
															<div className="space-y-4">
																{editError && (
																	<div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
																		{editError}
																	</div>
																)}
																<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
																	<div className="sm:col-span-2">
																		<Label htmlFor="edit-full-name">Full Name</Label>
																		<Input
																			id="edit-full-name" value={editForm.fullName}
																			onChange={(e) =>
																				setEditForm({
																					...editForm,
																					fullName: e.target.value,
																				})
																			}
																		/>
																	</div>
																	<div>
																		<Label htmlFor="edit-phone">Phone</Label>
																		<Input
																			id="edit-phone" value={editForm.phone}
																			onChange={(e) =>
																				setEditForm({
																					...editForm,
																					phone: e.target.value,
																				})
																			}
																		/>
																	</div>
																	<div>
																		<Label>Role</Label>
																		<Select
																			value={editForm.role}
																			onValueChange={(v) =>
																				setEditForm({
																					...editForm,
																					role: v as UserRole,
																				})
																			}>
																			<SelectTrigger aria-label="User role">
																				<SelectValue />
																			</SelectTrigger>
																			<SelectContent>
																				<SelectItem value="ADMIN">
																					Admin
																				</SelectItem>
																				<SelectItem value="EMPLOYEE">
																					Employee
																				</SelectItem>
																				<SelectItem value="CUSTOMER">
																					Customer
																				</SelectItem>
																			</SelectContent>
																		</Select>
																	</div>
																	<div className="sm:col-span-2">
																		<Label htmlFor="edit-password">
																			New Password{" "}
																			<span className="text-slate-600 text-xs">
																				(leave blank to keep current)
																			</span>
																		</Label>
																		<Input
																			type="password"
																			placeholder="New password"
																			id="edit-password" value={editForm.password}
																			onChange={(e) =>
																				setEditForm({
																					...editForm,
																					password: e.target.value,
																				})
																			}
																		/>
																	</div>
																</div>
																<div className="flex gap-2 justify-end">
																	<Button
																		variant="outline"
																		onClick={() => setEditUser(null)}>
																		Cancel
																	</Button>
																	<Button
																		onClick={handleSave}
																		disabled={saving}>
																		{saving ? (
																			<Loader2 className="h-4 w-4 mr-2 animate-spin" />
																		) : null}
																		Save Changes
																	</Button>
																</div>
															</div>
														</DialogContent>
													</Dialog>

													{/* Delete Button */}
													<Button
														variant="outline"
														size="sm"
														className="text-red-600 hover:text-red-700 hover:bg-red-50"
														aria-label={`Delete ${user.fullName}`} onClick={() => handleDelete(user.id, user.fullName)}
														disabled={deletingId === user.id}>
														{deletingId === user.id ? (
															<Loader2 className="h-3 w-3 animate-spin" />
														) : (
															<Trash2 className="h-3 w-3" />
														)}
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{users.length === 0 && (
								<div className="text-center py-8 text-gray-500">
									No users found
								</div>
							)}
						</div>
					)}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">Showing {total ? offset + 1 : 0}–{Math.min(offset + users.length, total)} of {total}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!offset || loading} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - 20)); }}>Previous users</Button><Button variant="outline" disabled={offset + 20 >= total || loading} onClick={() => { setLoading(true); setOffset(offset + 20); }}>Next users</Button></div></div>
				</CardContent>
			</Card>
		</div>
	);
}
