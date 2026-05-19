// mobile/lib/screens/super-admin/parcel_form_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/garage.dart';
import '../../models/parcel.dart';
import '../../models/user.dart';
import '../../services/api_service.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class ParcelFormScreen extends ConsumerStatefulWidget {
  final bool isEditing;
  final Parcel? parcel;
  
  const ParcelFormScreen({
    super.key,
    required this.isEditing,
    this.parcel,
  });

  @override
  ConsumerState<ParcelFormScreen> createState() => _ParcelFormScreenState();
}

class _ParcelFormScreenState extends ConsumerState<ParcelFormScreen> {
  final ApiService _apiService = ApiService();
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;
  
  // Controllers
  final _senderNameController = TextEditingController();
  final _senderPhoneController = TextEditingController();
  final _receiverNameController = TextEditingController();
  final _receiverPhoneController = TextEditingController();
  final _receiverEmailController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _weightController = TextEditingController();
  final _priceController = TextEditingController();
  final _trackingNumberController = TextEditingController();
  
  // Dropdown values
  ParcelType _selectedType = ParcelType.package;
  ParcelStatus _selectedStatus = ParcelStatus.pending;
  String? _selectedDepartureGarageId;
  String? _selectedArrivalGarageId;
  String? _selectedDriverId;
  String? _selectedPaymentMethod;
  
  // Lists
  List<Garage> _garages = [];
  List<User> _drivers = [];
  bool _loadingData = true;

  @override
  void initState() {
    super.initState();
    _loadData();
    if (widget.isEditing && widget.parcel != null) {
      _populateForm();
    }
  }

  Future<void> _loadData() async {
    try {
      final garages = await _apiService.getAllGaragesSuperAdmin();
      final allUsers = await _apiService.getAllUsersSuperAdmin();
      
      setState(() {
        _garages = garages;
        _drivers = allUsers.where((u) => u.role == UserRole.driver).toList();
        _loadingData = false;
      });
    } catch (e) {
      setState(() => _loadingData = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _populateForm() {
    final parcel = widget.parcel!;
    _senderNameController.text = parcel.senderName;
    _senderPhoneController.text = parcel.senderPhone;
    _receiverNameController.text = parcel.receiverName;
    _receiverPhoneController.text = parcel.receiverPhone;
    _receiverEmailController.text = parcel.receiverEmail ?? '';
    _descriptionController.text = parcel.description;
    _weightController.text = parcel.weight.toString();
    _priceController.text = parcel.price?.toString() ?? '';
    _trackingNumberController.text = parcel.trackingNumber;
    _selectedType = parcel.type;
    _selectedStatus = parcel.status;
    // CORRECTION: parcel.paymentMethod est déjà un String? 
    // donc on l'assigne directement sans .value
    _selectedPaymentMethod = parcel.paymentMethod;
  }

  @override
  void dispose() {
    _senderNameController.dispose();
    _senderPhoneController.dispose();
    _receiverNameController.dispose();
    _receiverPhoneController.dispose();
    _receiverEmailController.dispose();
    _descriptionController.dispose();
    _weightController.dispose();
    _priceController.dispose();
    _trackingNumberController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    
    setState(() => _isLoading = true);
    
    try {
      final data = {
        'senderName': _senderNameController.text.trim(),
        'senderPhone': _senderPhoneController.text.trim(),
        'receiverName': _receiverNameController.text.trim(),
        'receiverPhone': _receiverPhoneController.text.trim(),
        'receiverEmail': _receiverEmailController.text.trim().isEmpty ? null : _receiverEmailController.text.trim(),
        'description': _descriptionController.text.trim(),
        'weight': double.parse(_weightController.text.trim()),
        'type': _selectedType.value,
        'status': _selectedStatus.value,
        'departureGarageId': _selectedDepartureGarageId?.isEmpty == true ? null : _selectedDepartureGarageId,
        'arrivalGarageId': _selectedArrivalGarageId?.isEmpty == true ? null : _selectedArrivalGarageId,
        'driverId': _selectedDriverId?.isEmpty == true ? null : _selectedDriverId,
        'price': _priceController.text.isNotEmpty ? double.parse(_priceController.text.trim()) : null,
        'paymentMethod': _selectedPaymentMethod?.isEmpty == true ? null : _selectedPaymentMethod,
      };
      
      if (widget.isEditing && widget.parcel != null) {
        await _apiService.updateParcelStatus(
          widget.parcel!.id, 
          _selectedStatus.value,
        );
      } else {
        await _apiService.createParcel(data);
      }
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(widget.isEditing ? 'Colis modifié avec succès' : 'Colis créé avec succès'),
            backgroundColor: Colors.green,
          ),
        );
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
        title: Text(widget.isEditing ? 'Modifier le colis' : 'Nouveau colis'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
      ),
      body: _loadingData
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    // Section Expéditeur
                    _buildSectionTitle('Expéditeur'),
                    const SizedBox(height: 8),
                    CustomTextField(
                      controller: _senderNameController,
                      label: 'Nom complet',
                      prefixIcon: Icons.person,
                      validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                    ),
                    const SizedBox(height: 12),
                    CustomTextField(
                      controller: _senderPhoneController,
                      label: 'Téléphone',
                      prefixIcon: Icons.phone,
                      keyboardType: TextInputType.phone,
                      validator: (v) => v == null || v.isEmpty ? 'Champ requis' : null,
                    ),
                    const SizedBox(height: 24),
                    
                    // Section Destinataire
                    _buildSectionTitle('Destinataire'),
                    const SizedBox(height: 8),
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
                      label: 'Email',
                      prefixIcon: Icons.email,
                      keyboardType: TextInputType.emailAddress,
                    ),
                    const SizedBox(height: 24),
                    
                    // Section Détails du colis
                    _buildSectionTitle('Détails du colis'),
                    const SizedBox(height: 8),
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
                      value: _selectedType,
                      decoration: const InputDecoration(
                        labelText: 'Type de colis',
                        prefixIcon: Icon(Icons.category),
                        border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                      ),
                      items: ParcelType.values.map((type) => DropdownMenuItem(
                        value: type,
                        child: Row(
                          children: [
                            Icon(type.icon, size: 18),
                            const SizedBox(width: 8),
                            Text(type.label),
                          ],
                        ),
                      )).toList(),
                      onChanged: (value) => setState(() => _selectedType = value!),
                    ),
                    const SizedBox(height: 24),
                    
                    // Section Transport
                    _buildSectionTitle('Transport'),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      value: _selectedDepartureGarageId,
                      decoration: const InputDecoration(
                        labelText: 'Garage de départ',
                        prefixIcon: Icon(Icons.business),
                        border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                      ),
                      items: [
                        const DropdownMenuItem(value: null, child: Text('Sélectionner...')),
                        ..._garages.map((garage) => DropdownMenuItem(
                          value: garage.id,
                          child: Text(garage.name),
                        )),
                      ],
                      onChanged: (value) => setState(() => _selectedDepartureGarageId = value),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: _selectedArrivalGarageId,
                      decoration: const InputDecoration(
                        labelText: 'Garage d\'arrivée',
                        prefixIcon: Icon(Icons.business),
                        border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                      ),
                      items: [
                        const DropdownMenuItem(value: null, child: Text('Sélectionner...')),
                        ..._garages.map((garage) => DropdownMenuItem(
                          value: garage.id,
                          child: Text(garage.name),
                        )),
                      ],
                      onChanged: (value) => setState(() => _selectedArrivalGarageId = value),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: _selectedDriverId,
                      decoration: const InputDecoration(
                        labelText: 'Chauffeur assigné',
                        prefixIcon: Icon(Icons.delivery_dining),
                        border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                      ),
                      items: [
                        const DropdownMenuItem(value: null, child: Text('Aucun chauffeur')),
                        ..._drivers.map((driver) => DropdownMenuItem(
                          value: driver.id,
                          child: Text(driver.fullName),
                        )),
                      ],
                      onChanged: (value) => setState(() => _selectedDriverId = value),
                    ),
                    const SizedBox(height: 24),
                    
                    // Section Paiement
                    _buildSectionTitle('Paiement'),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String?>(
                      value: _selectedPaymentMethod,
                      decoration: const InputDecoration(
                        labelText: 'Mode de paiement',
                        prefixIcon: Icon(Icons.payment),
                        border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                      ),
                      items: const [
                        DropdownMenuItem(value: null, child: Text('Sélectionner...')),
                        DropdownMenuItem(value: 'cash', child: Text('Espèces')),
                        DropdownMenuItem(value: 'wave', child: Text('Wave')),
                        DropdownMenuItem(value: 'orange_money', child: Text('Orange Money')),
                        DropdownMenuItem(value: 'card', child: Text('Carte bancaire')),
                      ],
                      onChanged: (value) => setState(() => _selectedPaymentMethod = value),
                    ),
                    const SizedBox(height: 24),
                    
                    // Numéro de suivi (uniquement pour les nouveaux colis)
                    if (!widget.isEditing) ...[
                      CustomTextField(
                        controller: _trackingNumberController,
                        label: 'Numéro de suivi',
                        prefixIcon: Icons.numbers,
                        readOnly: true,
                      ),
                      const SizedBox(height: 24),
                    ],
                    
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

  Widget _buildSectionTitle(String title) {
    return Row(
      children: [
        Container(
          width: 4,
          height: 20,
          decoration: BoxDecoration(
            color: const Color(0xFF0B6E3A),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
        ),
      ],
    );
  }
}