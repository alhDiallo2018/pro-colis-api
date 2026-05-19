import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/garage.dart';
import '../../models/parcel.dart';
import '../../providers/parcel_provider.dart';
import '../../services/api_service.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class NewParcelScreen extends ConsumerStatefulWidget {
  const NewParcelScreen({super.key});

  @override
  ConsumerState<NewParcelScreen> createState() => _NewParcelScreenState();
}

class _NewParcelScreenState extends ConsumerState<NewParcelScreen> {
  final ApiService _apiService = ApiService();
  final _formKey = GlobalKey<FormState>();
  
  // Liste des garages depuis l'API
  List<Garage> _garages = [];
  bool _isLoadingGarages = true;
  
  // Destinataire
  final _receiverNameController = TextEditingController();
  final _receiverPhoneController = TextEditingController();
  final _receiverEmailController = TextEditingController();
  
  // Colis
  final _descriptionController = TextEditingController();
  final _weightController = TextEditingController();
  final _priceController = TextEditingController();
  ParcelType _selectedType = ParcelType.package;
  
  // Lieux (stocker les IDs UUID)
  String? _selectedDepartureGarageId;
  String? _selectedArrivalGarageId;
  
  bool _isLoading = false;
  bool _urgentDelivery = false;
  bool _insurance = false;

  @override
  void initState() {
    super.initState();
    _loadGarages();
  }

  Future<void> _loadGarages() async {
    setState(() {
      _isLoadingGarages = true;
    });
    
    try {
      final garages = await _apiService.getAllGarages();
      setState(() {
        _garages = garages;
        _isLoadingGarages = false;
      });
      debugPrint('✅ ${garages.length} garages chargés depuis l\'API');
      for (var garage in garages) {
        debugPrint('Garage: ${garage.name} - ID: ${garage.id}');
      }
    } catch (e) {
      setState(() {
        _isLoadingGarages = false;
      });
      debugPrint('❌ Erreur chargement garages: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur chargement garages: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  void dispose() {
    _receiverNameController.dispose();
    _receiverPhoneController.dispose();
    _receiverEmailController.dispose();
    _descriptionController.dispose();
    _weightController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _createParcel() async {
    if (!_formKey.currentState!.validate()) return;
    
    if (_selectedDepartureGarageId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Veuillez sélectionner un garage de départ'), backgroundColor: Colors.orange),
      );
      return;
    }
    
    setState(() => _isLoading = true);
    
    // Récupérer les noms des garages sélectionnés
    final departureGarage = _garages.firstWhere((g) => g.id == _selectedDepartureGarageId);
    final arrivalGarage = _selectedArrivalGarageId != null 
        ? _garages.firstWhere((g) => g.id == _selectedArrivalGarageId)
        : departureGarage;
    
    final data = {
      'receiverName': _receiverNameController.text.trim(),
      'receiverPhone': _receiverPhoneController.text.trim(),
      'receiverEmail': _receiverEmailController.text.trim().isEmpty ? null : _receiverEmailController.text.trim(),
      'description': _descriptionController.text.trim(),
      'weight': double.parse(_weightController.text),
      'type': _selectedType.value,
      'departureGarageId': _selectedDepartureGarageId,
      'departureGarageName': departureGarage.name,
      'arrivalGarageId': _selectedArrivalGarageId,
      'arrivalGarageName': arrivalGarage.name,
      'price': double.tryParse(_priceController.text) ?? 0,
      'urgent': _urgentDelivery,
      'insurance': _insurance,
    };
    
    try {
      final result = await ref.read(parcelProvider.notifier).createParcel(data);
      
      if (mounted) {
        setState(() => _isLoading = false);
      }
      
      if (result != null && mounted) {
        _showSuccessDialog(result);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erreur lors de la création du colis'), backgroundColor: Colors.red),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _showSuccessDialog(Parcel parcel) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('✅ Colis créé !'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle, size: 64, color: Colors.green),
            const SizedBox(height: 16),
            Text(
              'Numéro de suivi',
              style: TextStyle(color: Colors.grey[600]),
            ),
            const SizedBox(height: 8),
            Text(
              parcel.trackingNumber,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, fontFamily: 'monospace'),
            ),
            const SizedBox(height: 16),
            Text(
              'Un email de confirmation a été envoyé',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey[600]),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              Navigator.pop(context);
            },
            child: const Text('OK'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _resetForm();
            },
            child: const Text('Nouveau colis'),
          ),
        ],
      ),
    );
  }

  void _resetForm() {
    _receiverNameController.clear();
    _receiverPhoneController.clear();
    _receiverEmailController.clear();
    _descriptionController.clear();
    _weightController.clear();
    _priceController.clear();
    setState(() {
      _selectedType = ParcelType.package;
      _selectedDepartureGarageId = null;
      _selectedArrivalGarageId = null;
      _urgentDelivery = false;
      _insurance = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Nouveau colis'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
      ),
      body: _isLoadingGarages
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Section Destinataire
                    _buildSection(
                      icon: Icons.person,
                      title: 'Destinataire',
                      color: Colors.blue,
                      child: Column(
                        children: [
                          CustomTextField(
                            controller: _receiverNameController,
                            label: 'Nom complet',
                            prefixIcon: Icons.person,
                            validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                          ),
                          const SizedBox(height: 12),
                          CustomTextField(
                            controller: _receiverPhoneController,
                            label: 'Téléphone',
                            prefixIcon: Icons.phone,
                            keyboardType: TextInputType.phone,
                            validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                          ),
                          const SizedBox(height: 12),
                          CustomTextField(
                            controller: _receiverEmailController,
                            label: 'Email (optionnel)',
                            prefixIcon: Icons.email,
                            keyboardType: TextInputType.emailAddress,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    
                    // Section Colis
                    _buildSection(
                      icon: Icons.inventory,
                      title: 'Informations colis',
                      color: Colors.green,
                      child: Column(
                        children: [
                          CustomTextField(
                            controller: _descriptionController,
                            label: 'Description',
                            prefixIcon: Icons.description,
                            maxLines: 3,
                            validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: CustomTextField(
                                  controller: _weightController,
                                  label: 'Poids (kg)',
                                  prefixIcon: Icons.fitness_center,
                                  keyboardType: TextInputType.number,
                                  validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: CustomTextField(
                                  controller: _priceController,
                                  label: 'Prix (FCFA)',
                                  prefixIcon: Icons.money,
                                  keyboardType: TextInputType.number,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<ParcelType>(
                            initialValue: _selectedType,
                            decoration: const InputDecoration(
                              labelText: 'Type de colis',
                              prefixIcon: Icon(Icons.category),
                              border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                            ),
                            items: ParcelType.values.map((type) => DropdownMenuItem(
                              value: type,
                              child: Row(
                                children: [
                                  Icon(_getTypeIcon(type), size: 18),
                                  const SizedBox(width: 8),
                                  Text(type.label),
                                ],
                              ),
                            )).toList(),
                            onChanged: (value) => setState(() => _selectedType = value!),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    
                    // Section Trajet
                    _buildSection(
                      icon: Icons.route,
                      title: 'Trajet',
                      color: Colors.orange,
                      child: Column(
                        children: [
                          DropdownButtonFormField<String>(
                            initialValue: _selectedDepartureGarageId,
                            hint: const Text('Sélectionnez le garage de départ'),
                            decoration: const InputDecoration(
                              labelText: 'Garage départ',
                              prefixIcon: Icon(Icons.departure_board),
                              border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                            ),
                            items: _garages.map((garage) => DropdownMenuItem(
                              value: garage.id,
                              child: Text('${garage.name} - ${garage.city}'),
                            )).toList(),
                            onChanged: (value) => setState(() => _selectedDepartureGarageId = value),
                            validator: (v) => v == null ? 'Champ requis' : null,
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<String>(
                            initialValue: _selectedArrivalGarageId,
                            hint: const Text('Sélectionnez le garage d\'arrivée (optionnel)'),
                            decoration: const InputDecoration(
                              labelText: 'Garage arrivée',
                              prefixIcon: Icon(Icons.location_on),
                              border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                            ),
                            items: [
                              const DropdownMenuItem(value: null, child: Text('Aucun (même garage)')),
                              ..._garages.map((garage) => DropdownMenuItem(
                                value: garage.id,
                                child: Text('${garage.name} - ${garage.city}'),
                              )),
                            ],
                            onChanged: (value) => setState(() => _selectedArrivalGarageId = value),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    
                    // Options supplémentaires
                    _buildSection(
                      icon: Icons.settings,
                      title: 'Options',
                      color: Colors.purple,
                      child: Column(
                        children: [
                          SwitchListTile(
                            title: const Text('Livraison urgente'),
                            subtitle: const Text('Priorité + 500 FCFA'),
                            value: _urgentDelivery,
                            onChanged: (value) => setState(() => _urgentDelivery = value),
                            activeTrackColor: const Color(0xFF0B6E3A).withAlpha(128),
                            activeThumbColor: const Color(0xFF0B6E3A),
                            contentPadding: EdgeInsets.zero,
                          ),
                          SwitchListTile(
                            title: const Text('Assurance colis'),
                            subtitle: const Text('Protection jusqu\'à 50 000 FCFA'),
                            value: _insurance,
                            onChanged: (value) => setState(() => _insurance = value),
                            activeTrackColor: const Color(0xFF0B6E3A).withAlpha(128),
                            activeThumbColor: const Color(0xFF0B6E3A),
                            contentPadding: EdgeInsets.zero,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 32),
                    CustomButton(
                      text: 'Créer le colis',
                      onPressed: _createParcel,
                      isLoading: _isLoading,
                    ),
                    const SizedBox(height: 16),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildSection({
    required IconData icon,
    required String title,
    required Color color,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color),
              const SizedBox(width: 8),
              Text(title, style: TextStyle(fontWeight: FontWeight.bold, color: color)),
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  IconData _getTypeIcon(ParcelType type) {
    switch (type) {
      case ParcelType.document:
        return Icons.description;
      case ParcelType.package:
        return Icons.inventory;
      case ParcelType.fragile:
        return Icons.science;
      case ParcelType.perishable:
        return Icons.eco;
      case ParcelType.valuable:
        return Icons.attach_money;
    }
  }
}