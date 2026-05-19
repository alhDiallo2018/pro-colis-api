import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/user.dart';
import '../../services/api_service.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class UserFormScreen extends ConsumerStatefulWidget {
  final bool isEditing;
  final User? user;
  
  const UserFormScreen({
    super.key,
    required this.isEditing,
    this.user,
  });

  @override
  ConsumerState<UserFormScreen> createState() => _UserFormScreenState();
}

class _UserFormScreenState extends ConsumerState<UserFormScreen> {
  final ApiService _apiService = ApiService();
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;
  
  // Controllers
  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _cityController = TextEditingController();
  final _regionController = TextEditingController();
  final _vehiclePlateController = TextEditingController();
  final _vehicleModelController = TextEditingController();
  final _pinController = TextEditingController();
  
  // Selected values
  UserRole _selectedRole = UserRole.client;
  UserStatus _selectedStatus = UserStatus.active;
  Gender? _selectedGender;
  DriverStatus? _selectedDriverStatus;

  @override
  void initState() {
    super.initState();
    if (widget.isEditing && widget.user != null) {
      _populateForm();
    }
  }

  void _populateForm() {
    final user = widget.user!;
    _fullNameController.text = user.fullName;
    _emailController.text = user.email;
    _phoneController.text = user.phone;
    _addressController.text = user.address ?? '';
    _cityController.text = user.city ?? '';
    _regionController.text = user.region ?? '';
    _vehiclePlateController.text = user.vehiclePlate ?? '';
    _vehicleModelController.text = user.vehicleModel ?? '';
    _selectedRole = user.role;
    _selectedStatus = user.status;
    _selectedGender = user.gender;
    _selectedDriverStatus = user.driverStatus;
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

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    
    setState(() => _isLoading = true);
    
    try {
      bool success;
      if (widget.isEditing) {
        final result = await _apiService.updateUserSuperAdmin(
          userId: widget.user!.id,
          fullName: _fullNameController.text.trim(),
          email: _emailController.text.trim(),
          phone: _phoneController.text.trim(),
          role: _selectedRole.value,
          status: _selectedStatus.value,
          address: _addressController.text.trim(),
          city: _cityController.text.trim(),
          region: _regionController.text.trim(),
          vehiclePlate: _vehiclePlateController.text.trim(),
          vehicleModel: _vehicleModelController.text.trim(),
          driverStatus: _selectedDriverStatus?.value,
        );
        success = result['success'] == true;
      } else {
        final result = await _apiService.createUserSuperAdmin(
          fullName: _fullNameController.text.trim(),
          email: _emailController.text.trim(),
          phone: _phoneController.text.trim(),
          role: _selectedRole.value,
          status: _selectedStatus.value,
          address: _addressController.text.trim(),
          city: _cityController.text.trim(),
          region: _regionController.text.trim(),
          pin: _pinController.text.isEmpty ? '123456' : _pinController.text,
          gender: _selectedGender?.value,
          vehiclePlate: _vehiclePlateController.text.trim(),
          vehicleModel: _vehicleModelController.text.trim(),
          driverStatus: _selectedDriverStatus?.value,
        );
        success = result['success'] == true;
      }
      
      if (success && mounted) {
        Navigator.pop(context, true);
      }
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isEditing ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
      ),
      body: Form(
        key: _formKey,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
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
                value: _selectedRole,
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
                onChanged: (value) => setState(() => _selectedRole = value!),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<UserStatus>(
                value: _selectedStatus,
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
                onChanged: (value) => setState(() => _selectedStatus = value!),
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
                onChanged: (value) => setState(() => _selectedGender = value),
              ),
              if (_selectedRole == UserRole.driver) ...[
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
                  onChanged: (value) => setState(() => _selectedDriverStatus = value),
                ),
              ],
              if (!widget.isEditing) ...[
                const SizedBox(height: 12),
                CustomTextField(
                  controller: _pinController,
                  label: 'Code PIN (6 chiffres)',
                  prefixIcon: Icons.pin,
                  keyboardType: TextInputType.number,
                ),
              ],
              const SizedBox(height: 24),
              CustomButton(
                text: widget.isEditing ? 'Modifier' : 'Créer',
                onPressed: _save,
                isLoading: _isLoading,
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}