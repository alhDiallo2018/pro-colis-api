import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/garage.dart';
import '../../services/api_service.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class GarageFormScreen extends ConsumerStatefulWidget {
  final bool isEditing;
  final Garage? garage;
  
  const GarageFormScreen({
    super.key,
    required this.isEditing,
    this.garage,
  });

  @override
  ConsumerState<GarageFormScreen> createState() => _GarageFormScreenState();
}

class _GarageFormScreenState extends ConsumerState<GarageFormScreen> {
  final ApiService _apiService = ApiService();
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;
  
  final _nameController = TextEditingController();
  final _cityController = TextEditingController();
  final _regionController = TextEditingController();
  final _addressController = TextEditingController();
  final _phoneController = TextEditingController();
  final _latitudeController = TextEditingController();
  final _longitudeController = TextEditingController();

  @override
  void initState() {
    super.initState();
    if (widget.isEditing && widget.garage != null) {
      _populateForm();
    }
  }

  void _populateForm() {
    final garage = widget.garage!;
    _nameController.text = garage.name;
    _cityController.text = garage.city;
    _regionController.text = garage.region;
    _addressController.text = garage.address ?? '';
    _phoneController.text = garage.phone ?? '';
    _latitudeController.text = garage.latitude?.toString() ?? '';
    _longitudeController.text = garage.longitude?.toString() ?? '';
  }

  @override
  void dispose() {
    _nameController.dispose();
    _cityController.dispose();
    _regionController.dispose();
    _addressController.dispose();
    _phoneController.dispose();
    _latitudeController.dispose();
    _longitudeController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    
    setState(() => _isLoading = true);
    
    try {
      double? latitude;
      if (_latitudeController.text.trim().isNotEmpty) {
        latitude = double.parse(_latitudeController.text.trim());
      }
      
      double? longitude;
      if (_longitudeController.text.trim().isNotEmpty) {
        longitude = double.parse(_longitudeController.text.trim());
      }
      
      if (widget.isEditing && widget.garage != null) {
        // Modification du garage
        final result = await _apiService.updateGarageSuperAdmin(
          garageId: widget.garage!.id,
          name: _nameController.text.trim(),
          city: _cityController.text.trim(),
          region: _regionController.text.trim(),
          address: _addressController.text.trim().isEmpty ? null : _addressController.text.trim(),
          phone: _phoneController.text.trim().isEmpty ? null : _phoneController.text.trim(),
          latitude: latitude,
          longitude: longitude,
        );
        
        if (result['success'] == true && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Garage modifié avec succès'), backgroundColor: Colors.green),
          );
          Navigator.pop(context, true);
        } else if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(result['message'] ?? 'Erreur lors de la modification'), backgroundColor: Colors.red),
          );
        }
      } else {
        // Création d'un nouveau garage
        final result = await _apiService.createGarageSuperAdmin(
          name: _nameController.text.trim(),
          city: _cityController.text.trim(),
          region: _regionController.text.trim(),
          address: _addressController.text.trim().isEmpty ? null : _addressController.text.trim(),
          phone: _phoneController.text.trim().isEmpty ? null : _phoneController.text.trim(),
          latitude: latitude,
          longitude: longitude,
        );
        
        if (result['success'] == true && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Garage créé avec succès'), backgroundColor: Colors.green),
          );
          Navigator.pop(context, true);
        } else if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(result['message'] ?? 'Erreur lors de la création'), backgroundColor: Colors.red),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: ${e.toString()}'), backgroundColor: Colors.red),
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
        title: Text(widget.isEditing ? 'Modifier le garage' : 'Nouveau garage'),
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
                controller: _nameController,
                label: 'Nom du garage',
                prefixIcon: Icons.business,
                validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: _cityController,
                label: 'Ville',
                prefixIcon: Icons.location_city,
                validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: _regionController,
                label: 'Région',
                prefixIcon: Icons.map,
                validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: _addressController,
                label: 'Adresse',
                prefixIcon: Icons.location_on,
              ),
              const SizedBox(height: 12),
              CustomTextField(
                controller: _phoneController,
                label: 'Téléphone',
                prefixIcon: Icons.phone,
                keyboardType: TextInputType.phone,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      controller: _latitudeController,
                      label: 'Latitude',
                      prefixIcon: Icons.gps_fixed,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: CustomTextField(
                      controller: _longitudeController,
                      label: 'Longitude',
                      prefixIcon: Icons.gps_fixed,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    ),
                  ),
                ],
              ),
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