import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/user.dart';
import '../../services/api_service.dart';
import '../../widgets/custom_text_field.dart';

class UsersManagementScreen extends ConsumerStatefulWidget {
  const UsersManagementScreen({super.key});

  @override
  ConsumerState<UsersManagementScreen> createState() => _UsersManagementScreenState();
}

class _UsersManagementScreenState extends ConsumerState<UsersManagementScreen> {
  final ApiService _apiService = ApiService();
  List<User> _users = [];
  List<User> _filteredUsers = [];
  bool _isLoading = true;
  bool _isProcessing = false;
  String _searchQuery = '';
  UserRole? _selectedRole;
  UserStatus? _selectedStatus;
  
  // Dialog controllers
  User? _editingUser;
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _cityController = TextEditingController();
  final _regionController = TextEditingController();
  final _vehiclePlateController = TextEditingController();
  final _vehicleModelController = TextEditingController();
  final _pinController = TextEditingController();
  UserRole _selectedRoleForm = UserRole.client;
  UserStatus _selectedStatusForm = UserStatus.active;
  Gender? _selectedGender;
  DriverStatus? _selectedDriverStatus;

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _addressController.dispose();
    _cityController.dispose();
    _regionController.dispose();
    _vehiclePlateController.dispose();
    _vehicleModelController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    setState(() => _isLoading = true);
    try {
      _users = await _apiService.getAllUsersSuperAdmin();
      _applyFilters();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _applyFilters() {
    var filtered = List<User>.from(_users);
    
    if (_searchQuery.isNotEmpty) {
      filtered = filtered.where((u) =>
        u.fullName.toLowerCase().contains(_searchQuery.toLowerCase()) ||
        u.email.toLowerCase().contains(_searchQuery.toLowerCase()) ||
        u.phone.contains(_searchQuery)
      ).toList();
    }
    
    if (_selectedRole != null) {
      filtered = filtered.where((u) => u.role == _selectedRole).toList();
    }
    
    if (_selectedStatus != null) {
      filtered = filtered.where((u) => u.status == _selectedStatus).toList();
    }
    
    setState(() => _filteredUsers = filtered);
  }

  void _openCreateDialog() {
    _editingUser = null;
    _fullNameController.clear();
    _emailController.clear();
    _phoneController.clear();
    _addressController.clear();
    _cityController.clear();
    _regionController.clear();
    _vehiclePlateController.clear();
    _vehicleModelController.clear();
    _pinController.clear();
    _selectedRoleForm = UserRole.client;
    _selectedStatusForm = UserStatus.active;
    _selectedGender = null;
    _selectedDriverStatus = null;
    _showUserDialog(isEditing: false);
  }

  void _openEditDialog(User user) {
    _editingUser = user;
    _fullNameController.text = user.fullName;
    _emailController.text = user.email;
    _phoneController.text = user.phone;
    _addressController.text = user.address ?? '';
    _cityController.text = user.city ?? '';
    _regionController.text = user.region ?? '';
    _vehiclePlateController.text = user.vehiclePlate ?? '';
    _vehicleModelController.text = user.vehicleModel ?? '';
    _selectedRoleForm = user.role;
    _selectedStatusForm = user.status;
    _selectedGender = user.gender;
    _selectedDriverStatus = user.driverStatus;
    _showUserDialog(isEditing: true);
  }

  void _showUserDialog({required bool isEditing}) {
    showDialog(
      context: context,
      barrierDismissible: !_isProcessing,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(isEditing ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'),
          content: SingleChildScrollView(
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CustomTextField(
                    controller: _fullNameController,
                    label: 'Nom complet',
                    prefixIcon: Icons.person,
                    validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                  ),
                  const SizedBox(height: 12),
                  CustomTextField(
                    controller: _emailController,
                    label: 'Email',
                    prefixIcon: Icons.email,
                    keyboardType: TextInputType.emailAddress,
                    validator: (v) => v == null || !v.contains('@') ? 'Email valide requis' : null,
                  ),
                  const SizedBox(height: 12),
                  CustomTextField(
                    controller: _phoneController,
                    label: 'Téléphone',
                    prefixIcon: Icons.phone,
                    keyboardType: TextInputType.phone,
                    validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                  ),
                  const SizedBox(height: 12),
                  CustomTextField(
                    controller: _addressController,
                    label: 'Adresse',
                    prefixIcon: Icons.location_on,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: CustomTextField(
                          controller: _cityController,
                          label: 'Ville',
                          prefixIcon: Icons.location_city,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: CustomTextField(
                          controller: _regionController,
                          label: 'Région',
                          prefixIcon: Icons.map,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<UserRole>(
                    value: _selectedRoleForm,
                    decoration: const InputDecoration(
                      labelText: 'Rôle',
                      prefixIcon: Icon(Icons.admin_panel_settings),
                      border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                    ),
                    items: UserRole.values.map((role) => DropdownMenuItem(
                      value: role,
                      child: Row(
                        children: [
                          Icon(role.icon, size: 18, color: role.color),
                          const SizedBox(width: 8),
                          Text(role.label),
                        ],
                      ),
                    )).toList(),
                    onChanged: (value) => setDialogState(() => _selectedRoleForm = value!),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<UserStatus>(
                    value: _selectedStatusForm,
                    decoration: const InputDecoration(
                      labelText: 'Statut',
                      prefixIcon: Icon(Icons.badge),
                      border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                    ),
                    items: UserStatus.values.map((status) => DropdownMenuItem(
                      value: status,
                      child: Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: status.color,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(status.label),
                        ],
                      ),
                    )).toList(),
                    onChanged: (value) => setDialogState(() => _selectedStatusForm = value!),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<Gender>(
                    value: _selectedGender,
                    decoration: const InputDecoration(
                      labelText: 'Genre',
                      prefixIcon: Icon(Icons.person_outline),
                      border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                    ),
                    items: Gender.values.map((gender) => DropdownMenuItem(
                      value: gender,
                      child: Row(
                        children: [
                          Icon(gender.icon, size: 18),
                          const SizedBox(width: 8),
                          Text(gender.label),
                        ],
                      ),
                    )).toList(),
                    onChanged: (value) => setDialogState(() => _selectedGender = value),
                  ),
                  if (_selectedRoleForm == UserRole.driver) ...[
                    const SizedBox(height: 12),
                    CustomTextField(
                      controller: _vehiclePlateController,
                      label: 'Plaque d\'immatriculation',
                      prefixIcon: Icons.local_taxi,
                    ),
                    const SizedBox(height: 12),
                    CustomTextField(
                      controller: _vehicleModelController,
                      label: 'Modèle du véhicule',
                      prefixIcon: Icons.directions_car,
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<DriverStatus>(
                      value: _selectedDriverStatus,
                      decoration: const InputDecoration(
                        labelText: 'Statut chauffeur',
                        prefixIcon: Icon(Icons.delivery_dining),
                        border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                      ),
                      items: DriverStatus.values.map((status) => DropdownMenuItem(
                        value: status,
                        child: Row(
                          children: [
                            Container(
                              width: 10,
                              height: 10,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: status.color,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(status.label),
                          ],
                        ),
                      )).toList(),
                      onChanged: (value) => setDialogState(() => _selectedDriverStatus = value),
                    ),
                  ],
                  if (!isEditing) ...[
                    const SizedBox(height: 12),
                    CustomTextField(
                      controller: _pinController,
                      label: 'Code PIN (6 chiffres)',
                      prefixIcon: Icons.pin,
                      keyboardType: TextInputType.number,
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: _isProcessing ? null : () => Navigator.pop(dialogContext),
              child: const Text('Annuler'),
            ),
            ElevatedButton(
              onPressed: _isProcessing ? null : () async {
                if (_formKey.currentState!.validate()) {
                  setDialogState(() => _isProcessing = true);
                  if (isEditing) {
                    await _updateUser();
                  } else {
                    await _createUser();
                  }
                  setDialogState(() => _isProcessing = false);
                  if (mounted) {
                    Navigator.pop(dialogContext);
                  }
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF0B6E3A)),
              child: Text(isEditing ? 'Modifier' : 'Créer'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _createUser() async {
    final pin = _pinController.text.isEmpty ? '123456' : _pinController.text;
    final result = await _apiService.createUserSuperAdmin(
      fullName: _fullNameController.text.trim(),
      email: _emailController.text.trim(),
      phone: _phoneController.text.trim(),
      role: _selectedRoleForm.value,
      status: _selectedStatusForm.value,
      address: _addressController.text.trim(),
      city: _cityController.text.trim(),
      region: _regionController.text.trim(),
      pin: pin,
      gender: _selectedGender?.value,
      vehiclePlate: _vehiclePlateController.text.trim(),
      vehicleModel: _vehicleModelController.text.trim(),
      driverStatus: _selectedDriverStatus?.value,
    );
    
    if (result['success'] == true && mounted) {
      await _loadUsers();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Utilisateur créé avec succès'), backgroundColor: Colors.green),
        );
      }
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result['message'] ?? 'Erreur lors de la création'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _updateUser() async {
    if (_editingUser == null) return;
    
    final result = await _apiService.updateUserSuperAdmin(
      userId: _editingUser!.id,
      fullName: _fullNameController.text.trim(),
      email: _emailController.text.trim(),
      phone: _phoneController.text.trim(),
      role: _selectedRoleForm.value,
      status: _selectedStatusForm.value,
      address: _addressController.text.trim(),
      city: _cityController.text.trim(),
      region: _regionController.text.trim(),
      vehiclePlate: _vehiclePlateController.text.trim(),
      vehicleModel: _vehicleModelController.text.trim(),
      driverStatus: _selectedDriverStatus?.value,
    );
    
    if (result['success'] == true && mounted) {
      await _loadUsers();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Utilisateur modifié avec succès'), backgroundColor: Colors.green),
        );
      }
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result['message'] ?? 'Erreur lors de la modification'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _toggleUserStatus(User user) async {
    final newStatus = user.status == UserStatus.active ? UserStatus.suspended : UserStatus.active;
    final result = await _apiService.updateUserStatusSuperAdmin(user.id, newStatus.value);
    
    if (result['success'] == true && mounted) {
      await _loadUsers();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Utilisateur ${newStatus.label}'), backgroundColor: Colors.green),
        );
      }
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result['message'] ?? 'Erreur'), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _deleteUser(User user) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Confirmation'),
        content: Text('Voulez-vous vraiment supprimer ${user.fullName} ?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false), 
            child: const Text('Annuler'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Supprimer'),
          ),
        ],
      ),
    );
    
    if (confirm == true && mounted) {
      final result = await _apiService.deleteUserSuperAdmin(user.id);
      if (result['success'] == true && mounted) {
        await _loadUsers();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Utilisateur supprimé'), backgroundColor: Colors.green),
          );
        }
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(result['message'] ?? 'Erreur lors de la suppression'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _resetUserPin(User user) async {
    final result = await _apiService.resetUserPin(user.id);
    if (result['success'] == true && mounted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('PIN réinitialisé à 123456'), backgroundColor: Colors.green),
        );
      }
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result['message'] ?? 'Erreur lors de la réinitialisation'), backgroundColor: Colors.red),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gestion des utilisateurs'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: _openCreateDialog,
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadUsers,
          ),
        ],
      ),
      body: Column(
        children: [
          // Barre de recherche et filtres
          Container(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                TextField(
                  decoration: InputDecoration(
                    hintText: 'Rechercher...',
                    prefixIcon: const Icon(Icons.search),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    filled: true,
                    fillColor: Colors.grey.shade50,
                  ),
                  onChanged: (value) {
                    _searchQuery = value;
                    _applyFilters();
                  },
                ),
                const SizedBox(height: 12),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _FilterChip(
                        label: 'Tous',
                        selected: _selectedRole == null && _selectedStatus == null,
                        onSelected: () {
                          setState(() {
                            _selectedRole = null;
                            _selectedStatus = null;
                            _applyFilters();
                          });
                        },
                      ),
                      const SizedBox(width: 8),
                      ...UserRole.values.map((role) => _FilterChip(
                        label: role.label,
                        selected: _selectedRole == role,
                        color: role.color,
                        onSelected: () {
                          setState(() {
                            _selectedRole = _selectedRole == role ? null : role;
                            _selectedStatus = null;
                            _applyFilters();
                          });
                        },
                      )),
                      const SizedBox(width: 8),
                      ...UserStatus.values.map((status) => _FilterChip(
                        label: status.label,
                        selected: _selectedStatus == status,
                        color: status.color,
                        onSelected: () {
                          setState(() {
                            _selectedStatus = _selectedStatus == status ? null : status;
                            _selectedRole = null;
                            _applyFilters();
                          });
                        },
                      )),
                    ],
                  ),
                ),
              ],
            ),
          ),
          
          // Liste des utilisateurs
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _filteredUsers.isEmpty
                    ? const Center(child: Text('Aucun utilisateur trouvé'))
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        itemCount: _filteredUsers.length,
                        itemBuilder: (context, index) {
                          final user = _filteredUsers[index];
                          return Card(
                            margin: const EdgeInsets.only(bottom: 12),
                            child: ExpansionTile(
                              leading: CircleAvatar(
                                backgroundColor: user.role.color.withAlpha(25),
                                child: Icon(user.role.icon, color: user.role.color),
                              ),
                              title: Text(user.fullName),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(user.email, style: const TextStyle(fontSize: 12)),
                                  const SizedBox(height: 4),
                                  Row(
                                    children: [
                                      Container(
                                        width: 8,
                                        height: 8,
                                        decoration: BoxDecoration(
                                          shape: BoxShape.circle,
                                          color: user.status.color,
                                        ),
                                      ),
                                      const SizedBox(width: 4),
                                      Text(user.status.label, style: TextStyle(fontSize: 10, color: user.status.color)),
                                      const SizedBox(width: 8),
                                      Text(user.role.label, style: TextStyle(fontSize: 10, color: user.role.color)),
                                    ],
                                  ),
                                ],
                              ),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  IconButton(
                                    icon: const Icon(Icons.edit, color: Colors.blue),
                                    onPressed: () => _openEditDialog(user),
                                  ),
                                  IconButton(
                                    icon: Icon(user.status == UserStatus.active ? Icons.block : Icons.check_circle, 
                                        color: user.status == UserStatus.active ? Colors.orange : Colors.green),
                                    onPressed: () => _toggleUserStatus(user),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.delete, color: Colors.red),
                                    onPressed: () => _deleteUser(user),
                                  ),
                                ],
                              ),
                              children: [
                                Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Column(
                                    children: [
                                      _InfoRow(label: 'Téléphone', value: user.phone),
                                      if (user.address != null && user.address!.isNotEmpty) 
                                        _InfoRow(label: 'Adresse', value: user.address!),
                                      if (user.city != null && user.city!.isNotEmpty) 
                                        _InfoRow(label: 'Ville', value: user.city!),
                                      if (user.region != null && user.region!.isNotEmpty) 
                                        _InfoRow(label: 'Région', value: user.region!),
                                      if (user.garageId != null && user.garageId!.isNotEmpty) 
                                        _InfoRow(label: 'Garage ID', value: user.garageId!),
                                      if (user.vehiclePlate != null && user.vehiclePlate!.isNotEmpty) 
                                        _InfoRow(label: 'Plaque', value: user.vehiclePlate!),
                                      if (user.vehicleModel != null && user.vehicleModel!.isNotEmpty) 
                                        _InfoRow(label: 'Modèle', value: user.vehicleModel!),
                                      if (user.driverStatus != null) 
                                        _InfoRow(label: 'Statut chauffeur', value: user.driverStatus!.label),
                                      _InfoRow(label: 'Email vérifié', value: user.isEmailVerified ? 'Oui' : 'Non'),
                                      _InfoRow(label: 'Téléphone vérifié', value: user.isPhoneVerified ? 'Oui' : 'Non'),
                                      _InfoRow(label: 'Inscription', value: _formatDate(user.createdAt)),
                                      if (user.lastLogin != null) 
                                        _InfoRow(label: 'Dernière connexion', value: _formatDate(user.lastLogin!)),
                                      const SizedBox(height: 12),
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton.icon(
                                              onPressed: () => _resetUserPin(user),
                                              icon: const Icon(Icons.refresh, size: 18),
                                              label: const Text('Réinitialiser PIN'),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: OutlinedButton.icon(
                                              onPressed: () {},
                                              icon: const Icon(Icons.history, size: 18),
                                              label: const Text('Historique'),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year} ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onSelected;
  final Color? color;

  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onSelected,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onSelected(),
      backgroundColor: Colors.grey.shade100,
      selectedColor: (color ?? const Color(0xFF0B6E3A)).withAlpha(51),
      checkmarkColor: color ?? const Color(0xFF0B6E3A),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12))),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 12))),
        ],
      ),
    );
  }
}