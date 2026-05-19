import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/screens/super-admin/garage_drivers_screen.dart';

import '../../models/garage.dart';
import '../../services/api_service.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class GaragesManagementScreen extends ConsumerStatefulWidget {
  const GaragesManagementScreen({super.key});

  @override
  ConsumerState<GaragesManagementScreen> createState() => _GaragesManagementScreenState();
}

class _GaragesManagementScreenState extends ConsumerState<GaragesManagementScreen> {
  final ApiService _apiService = ApiService();
  List<Garage> _garages = [];
  bool _isLoading = true;
  bool _isProcessing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadGarages();
  }

  Future<void> _loadGarages() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final garages = await _apiService.getAllGaragesSuperAdmin();
      setState(() {
        _garages = garages;
        _isLoading = false;
      });
      debugPrint('📦 ${garages.length} garages chargés depuis la base de données');
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
      debugPrint('❌ Erreur chargement garages: $e');
    }
  }

  Future<void> _refreshData() async {
    await _loadGarages();
  }

  Future<void> _addGarage() async {
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => const _GarageFormScreen(isEditing: false),
      ),
    );
    
    if (result == true && mounted) {
      await _loadGarages();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Garage ajouté avec succès'), backgroundColor: Colors.green),
        );
      }
    }
  }

  Future<void> _editGarage(Garage garage) async {
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => _GarageFormScreen(isEditing: true, garage: garage),
      ),
    );
    
    if (result == true && mounted) {
      await _loadGarages();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Garage modifié avec succès'), backgroundColor: Colors.green),
        );
      }
    }
  }

  Future<void> _viewDrivers(Garage garage) async {
  await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (context) => GarageDriversScreen(garage: garage),
    ),
  );
}

  Future<void> _deleteGarage(Garage garage) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Supprimer le garage'),
        content: Text('Voulez-vous vraiment supprimer le garage "${garage.name}" ?'),
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
      setState(() => _isProcessing = true);
      try {
        final result = await _apiService.deleteGarageSuperAdmin(garage.id);
        if (result['success'] == true) {
          await _loadGarages();
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Garage supprimé avec succès'), backgroundColor: Colors.green),
            );
          }
        } else {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(result['message'] ?? 'Erreur lors de la suppression'), backgroundColor: Colors.red),
            );
          }
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
          );
        }
      } finally {
        if (mounted) {
          setState(() => _isProcessing = false);
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gestion des garages'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: _addGarage,
            tooltip: 'Ajouter un garage',
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadGarages,
            tooltip: 'Rafraîchir',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshData,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.error_outline, size: 64, color: Colors.red),
                        const SizedBox(height: 16),
                        Text('Erreur: $_error'),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _loadGarages,
                          child: const Text('Réessayer'),
                        ),
                      ],
                    ),
                  )
                : _garages.isEmpty
                    ? const Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.business, size: 64, color: Colors.grey),
                            SizedBox(height: 16),
                            Text('Aucun garage enregistré'),
                            SizedBox(height: 8),
                            Text('Appuyez sur le bouton + pour ajouter un garage'),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _garages.length,
                        itemBuilder: (context, index) {
                          final garage = _garages[index];
                          return Card(
                            margin: const EdgeInsets.only(bottom: 12),
                            elevation: 2,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: ExpansionTile(
                              leading: Container(
                                width: 50,
                                height: 50,
                                decoration: BoxDecoration(
                                  color: const Color(0xFF0B6E3A).withAlpha(25),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: const Icon(Icons.business, color: Color(0xFF0B6E3A), size: 28),
                              ),
                              title: Text(
                                garage.name,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(garage.city, style: const TextStyle(fontSize: 12)),
                                  const SizedBox(height: 4),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: Colors.green.withAlpha(25),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(
                                      '${garage.driversCount} chauffeurs',
                                      style: const TextStyle(fontSize: 10, color: Colors.green),
                                    ),
                                  ),
                                ],
                              ),
                              trailing: Chip(
                                label: Text('${garage.parcelsCount} colis'),
                                backgroundColor: Colors.orange.withAlpha(25),
                                labelStyle: const TextStyle(fontSize: 12, color: Colors.orange),
                              ),
                              children: [
                                Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Column(
                                    children: [
                                      _InfoRow(label: 'Région', value: garage.region),
                                      if (garage.address != null && garage.address!.isNotEmpty)
                                        _InfoRow(label: 'Adresse', value: garage.address!),
                                      if (garage.phone != null && garage.phone!.isNotEmpty)
                                        _InfoRow(label: 'Téléphone', value: garage.phone!),
                                      if (garage.latitude != null && garage.longitude != null)
                                        _InfoRow(
                                          label: 'Coordonnées',
                                          value: '${garage.latitude!.toStringAsFixed(4)}, ${garage.longitude!.toStringAsFixed(4)}',
                                        ),
                                      const Divider(height: 24),
                                      _InfoRow(
                                        label: 'Chauffeurs',
                                        value: garage.driversCount.toString(),
                                        valueColor: Colors.green,
                                      ),
                                      _InfoRow(
                                        label: 'Colis traités',
                                        value: garage.parcelsCount.toString(),
                                        valueColor: Colors.orange,
                                      ),
                                      _InfoRow(
                                        label: 'Chiffre d\'affaires',
                                        value: '${garage.revenue.toInt()} FCFA',
                                        valueColor: Colors.blue,
                                        isBold: true,
                                      ),
                                      const SizedBox(height: 16),
                                      Row(
                                        children: [
                                          Expanded(
                                            child: OutlinedButton.icon(
                                              onPressed: () => _editGarage(garage),
                                              icon: const Icon(Icons.edit, size: 18),
                                              label: const Text('Modifier'),
                                              style: OutlinedButton.styleFrom(
                                                foregroundColor: Colors.blue,
                                                side: const BorderSide(color: Colors.blue),
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: OutlinedButton.icon(
                                              onPressed: () => _viewDrivers(garage),
                                              icon: const Icon(Icons.people, size: 18),
                                              label: const Text('Chauffeurs'),
                                              style: OutlinedButton.styleFrom(
                                                foregroundColor: Colors.green,
                                                side: const BorderSide(color: Colors.green),
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 8),
                                      OutlinedButton.icon(
                                        onPressed: _isProcessing ? null : () => _deleteGarage(garage),
                                        icon: _isProcessing 
                                            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                            : const Icon(Icons.delete, size: 18),
                                        label: const Text('Supprimer'),
                                        style: OutlinedButton.styleFrom(
                                          foregroundColor: Colors.red,
                                          side: const BorderSide(color: Colors.red),
                                        ),
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
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool isBold;

  const _InfoRow({
    required this.label,
    required this.value,
    this.valueColor,
    this.isBold = false,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.w500, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontWeight: isBold ? FontWeight.bold : FontWeight.w500,
                fontSize: 13,
                color: valueColor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// Formulaire de garage pour ajout/modification (privé à ce fichier)
class _GarageFormScreen extends StatefulWidget {
  final bool isEditing;
  final Garage? garage;
  
  const _GarageFormScreen({
    required this.isEditing,
    this.garage,
  });

  @override
  State<_GarageFormScreen> createState() => _GarageFormScreenState();
}

class _GarageFormScreenState extends State<_GarageFormScreen> {
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